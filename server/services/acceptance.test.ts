import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "~~/server/database/client";
import { disk, smartReading } from "~~/server/database/schema";
import {
  acceptFault,
  activeAcceptances,
  clearAcceptance,
  listAcceptances,
} from "~~/server/services/acceptance";
import { listDiary } from "~~/server/services/diary";
import type { DiskRow } from "~~/server/services/disks";
import { recordIngest } from "~~/server/services/ingest";
import { getSmartOverview } from "~~/server/services/smart";
import { ServiceError } from "~~/server/utils/serviceError";
import { flushDb } from "~~/test/db";
import { readFixture } from "~~/test/fixtures";

const t0 = new Date("2026-09-01T10:00:00Z");
const HOUR_MS = 60 * 60 * 1000;
const SDB = readFixture("mars/smartctl/xall-sdb-auto.json");
const SDB_SERIAL = JSON.parse(SDB).serial_number as string;

function at(offsetMs: number) {
  return new Date(t0.getTime() + offsetMs);
}

function ingestSmart(body: string, receivedAt = t0) {
  const outcome = recordIngest({
    hostName: "mars",
    source: "smartctl-xall",
    meta: { device: "/dev/sdb", type: "sat", exitStatus: 0 },
    body,
    receivedAt,
  });
  expect(outcome.ok).toBe(true);
}

function withAttributeRaw(body: string, attrId: number, raw: number) {
  const json = JSON.parse(body);
  const attribute = json.ata_smart_attributes.table.find(
    (row: { id: number }) => row.id === attrId,
  );
  attribute.raw = { value: raw, string: String(raw) };
  return JSON.stringify(json);
}

function k2(): DiskRow {
  return db
    .select()
    .from(disk)
    .where(eq(disk.serial, SDB_SERIAL))
    .get() as DiskRow;
}

function events(diskId: number, eventType: string) {
  return listDiary({ subjectType: "disk", subjectId: diskId }).filter(
    (entry) => entry.eventType === eventType,
  );
}

function attribute(diskId: number, attrId: string) {
  return getSmartOverview(diskId, "30d", at(10 * HOUR_MS)).attributes.find(
    (candidate) => candidate.attrId === attrId,
  );
}

function latestReadingStatus(diskId: number) {
  return db
    .select({ deviceStatus: smartReading.deviceStatus })
    .from(smartReading)
    .where(eq(smartReading.diskId, diskId))
    .orderBy(smartReading.id)
    .all()
    .at(-1)?.deviceStatus;
}

function expectServiceError(operation: () => unknown, statusCode: number) {
  try {
    operation();
  } catch (error) {
    expect(error).toBeInstanceOf(ServiceError);
    expect((error as ServiceError).statusCode).toBe(statusCode);
    return;
  }
  throw new Error(`expected a ${statusCode} ServiceError`);
}

function withoutFaults(body: string) {
  return withAttributeRaw(withAttributeRaw(body, 197, 0), 198, 0);
}

beforeEach(() => {
  flushDb();
});

describe("acceptFault", () => {
  it("accepts the latest value, overlays it and recomputes the disk status", () => {
    ingestSmart(withAttributeRaw(SDB, 198, 0));
    const diskId = k2().id;
    expect(k2().latestStatus).toBe("failed");

    const row = acceptFault({
      diskId,
      attrId: "197",
      note: "stable for months",
      now: at(HOUR_MS),
    });

    expect(row).toMatchObject({
      diskId,
      attrId: "197",
      acceptedValue: 16,
      acceptedAt: at(HOUR_MS),
      note: "stable for months",
      supersededAt: null,
      clearedAt: null,
    });
    expect(attribute(diskId, "197")).toMatchObject({
      status: "failed",
      displayStatus: "accepted",
      acceptance: {
        id: row.id,
        acceptedValue: 16,
        acceptedAt: at(HOUR_MS),
        note: "stable for months",
      },
    });
    expect(attribute(diskId, "5")).toMatchObject({
      displayStatus: "passed",
      acceptance: null,
    });
    expect(k2().latestStatus).toBe("passed");
    expect(latestReadingStatus(diskId)).toBe("passed");
    expect(events(diskId, "fault-accepted")).toMatchObject([
      {
        at: at(HOUR_MS),
        data: {
          attrId: "197",
          acceptedValue: 16,
          trend: "new",
          note: "stable for months",
        },
      },
    ]);
    expect(events(diskId, "smart-status-changed")).toMatchObject([
      {
        at: at(HOUR_MS),
        data: {
          from: "failed",
          to: "passed",
          failing: [],
          cause: "acceptance",
        },
      },
    ]);
  });

  it("keeps the disk failed while another attribute still fails", () => {
    ingestSmart(withAttributeRaw(withAttributeRaw(SDB, 198, 0), 5, 500));
    const diskId = k2().id;
    const failing = getSmartOverview(diskId, "30d")
      .attributes.filter((candidate) => candidate.status === "failed")
      .map((candidate) => candidate.attrId);
    expect(failing).toEqual(["5", "197"]);

    acceptFault({ diskId, attrId: "197", now: at(HOUR_MS) });

    expect(k2().latestStatus).toBe("failed");
    expect(events(diskId, "smart-status-changed")).toHaveLength(0);
  });

  it("409s when the attribute is already accepted", () => {
    ingestSmart(SDB);
    const diskId = k2().id;
    acceptFault({ diskId, attrId: "197" });
    expectServiceError(() => acceptFault({ diskId, attrId: "197" }), 409);
    expect(listAcceptances(diskId)).toHaveLength(1);
  });

  it("404s for an unknown disk or an attribute missing from the latest reading", () => {
    ingestSmart(SDB);
    expectServiceError(
      () => acceptFault({ diskId: 99999, attrId: "197" }),
      404,
    );
    expectServiceError(
      () => acceptFault({ diskId: k2().id, attrId: "999" }),
      404,
    );
  });
});

describe("acknowledging", () => {
  it("keeps the fault visible but drops the disk to a warning", () => {
    ingestSmart(withAttributeRaw(SDB, 198, 0));
    const diskId = k2().id;

    const row = acceptFault({
      diskId,
      attrId: "197",
      kind: "acknowledge",
      note: "watching",
      now: at(HOUR_MS),
    });

    expect(row).toMatchObject({ kind: "acknowledge", acceptedValue: 16 });
    expect(attribute(diskId, "197")).toMatchObject({
      status: "failed",
      displayStatus: "acknowledged",
      acceptance: { id: row.id, kind: "acknowledge", acceptedValue: 16 },
    });
    expect(k2().latestStatus).toBe("warning");
    expect(latestReadingStatus(diskId)).toBe("warning");
    expect(events(diskId, "fault-acknowledged")).toMatchObject([
      { data: { attrId: "197", acceptedValue: 16, note: "watching" } },
    ]);
    expect(events(diskId, "smart-status-changed")).toMatchObject([
      {
        data: {
          from: "failed",
          to: "warning",
          failing: [],
          acknowledged: ["197"],
          cause: "acceptance",
        },
      },
    ]);
  });

  it("goes back to failed once the value rises, and holds when it drops", () => {
    const quiet = withAttributeRaw(SDB, 198, 0);
    ingestSmart(quiet);
    const diskId = k2().id;
    acceptFault({
      diskId,
      attrId: "197",
      kind: "acknowledge",
      now: at(HOUR_MS),
    });

    ingestSmart(withAttributeRaw(quiet, 197, 12), at(2 * HOUR_MS));
    expect(k2().latestStatus).toBe("warning");
    expect(activeAcceptances(diskId).has("197")).toBe(true);

    ingestSmart(withAttributeRaw(quiet, 197, 17), at(3 * HOUR_MS));

    expect(activeAcceptances(diskId).size).toBe(0);
    expect(k2().latestStatus).toBe("failed");
    expect(events(diskId, "acknowledgement-superseded")).toMatchObject([
      {
        title: "Current Pending Sector Count rose to 17 (acknowledged at 16)",
        data: { attrId: "197", acceptedValue: 16, value: 17 },
      },
    ]);
    expect(events(diskId, "smart-status-changed")[0]).toMatchObject({
      data: {
        from: "warning",
        to: "failed",
        superseded: ["197"],
        cause: "reading",
      },
    });
  });

  it("switches kind in one step and 409s on the same kind", () => {
    ingestSmart(withAttributeRaw(SDB, 198, 0));
    const diskId = k2().id;
    const first = acceptFault({
      diskId,
      attrId: "197",
      kind: "acknowledge",
      now: at(HOUR_MS),
    });
    expectServiceError(
      () => acceptFault({ diskId, attrId: "197", kind: "acknowledge" }),
      409,
    );

    const accepted = acceptFault({
      diskId,
      attrId: "197",
      now: at(2 * HOUR_MS),
    });

    expect(activeAcceptances(diskId).get("197")?.id).toBe(accepted.id);
    expect(
      listAcceptances(diskId).find((row) => row.id === first.id),
    ).toMatchObject({ clearedAt: at(2 * HOUR_MS) });
    expect(events(diskId, "fault-accepted")).toMatchObject([
      { data: { replaces: "acknowledge" } },
    ]);
    expect(events(diskId, "acknowledgement-cleared")).toHaveLength(0);
    expect(k2().latestStatus).toBe("passed");
  });

  it("clears with its own event", () => {
    ingestSmart(withAttributeRaw(SDB, 198, 0));
    const diskId = k2().id;
    acceptFault({
      diskId,
      attrId: "197",
      kind: "acknowledge",
      now: at(HOUR_MS),
    });

    clearAcceptance(diskId, "197", at(2 * HOUR_MS));

    expect(k2().latestStatus).toBe("failed");
    expect(events(diskId, "acknowledgement-cleared")).toMatchObject([
      { data: { attrId: "197", acceptedValue: 16 } },
    ]);
    expect(events(diskId, "acceptance-cleared")).toHaveLength(0);
  });
});

describe("clearAcceptance", () => {
  it("clears the active acceptance and restores the real status", () => {
    ingestSmart(withAttributeRaw(SDB, 198, 0));
    const diskId = k2().id;
    acceptFault({ diskId, attrId: "197", now: at(HOUR_MS) });

    const cleared = clearAcceptance(diskId, "197", at(2 * HOUR_MS));

    expect(cleared.clearedAt).toEqual(at(2 * HOUR_MS));
    expect(activeAcceptances(diskId).size).toBe(0);
    expect(attribute(diskId, "197")).toMatchObject({
      displayStatus: "failed",
      acceptance: null,
    });
    expect(k2().latestStatus).toBe("failed");
    expect(events(diskId, "acceptance-cleared")).toMatchObject([
      { data: { attrId: "197", acceptedValue: 16 } },
    ]);
    expect(
      events(diskId, "smart-status-changed").map((entry) => entry.data.to),
    ).toEqual(["failed", "passed"]);
  });

  it("404s without an active acceptance", () => {
    ingestSmart(SDB);
    expectServiceError(() => clearAcceptance(k2().id, "197"), 404);
  });
});

describe("supersedeIfRisen", () => {
  it("keeps the acceptance while the value holds and supersedes it once it rises", () => {
    const quiet = withAttributeRaw(SDB, 198, 0);
    ingestSmart(quiet);
    const diskId = k2().id;
    acceptFault({ diskId, attrId: "197", now: at(HOUR_MS) });

    ingestSmart(quiet, at(2 * HOUR_MS));
    expect(k2().latestStatus).toBe("passed");
    expect(activeAcceptances(diskId).has("197")).toBe(true);

    ingestSmart(withAttributeRaw(quiet, 197, 24), at(3 * HOUR_MS));

    expect(activeAcceptances(diskId).size).toBe(0);
    expect(listAcceptances(diskId)[0].supersededAt).toEqual(at(3 * HOUR_MS));
    expect(k2().latestStatus).toBe("failed");
    expect(latestReadingStatus(diskId)).toBe("failed");
    expect(attribute(diskId, "197")).toMatchObject({
      displayStatus: "failed",
      acceptance: null,
    });
    expect(events(diskId, "acceptance-superseded")).toMatchObject([
      {
        at: at(3 * HOUR_MS),
        data: { attrId: "197", acceptedValue: 16, value: 24 },
      },
    ]);
    expect(
      events(diskId, "smart-status-changed").map((entry) => entry.data.to),
    ).toEqual(["failed", "passed"]);
  });

  it("allows a fresh acceptance after a superseded one", () => {
    ingestSmart(SDB);
    const diskId = k2().id;
    acceptFault({ diskId, attrId: "197", now: at(HOUR_MS) });
    ingestSmart(withAttributeRaw(SDB, 197, 24), at(2 * HOUR_MS));

    const again = acceptFault({ diskId, attrId: "197", now: at(3 * HOUR_MS) });

    expect(again.acceptedValue).toBe(24);
    expect(listAcceptances(diskId).map((row) => row.id)).toEqual([
      again.id,
      expect.any(Number),
    ]);
  });

  it("leaves acceptances alone when the value drops", () => {
    ingestSmart(SDB);
    const diskId = k2().id;
    acceptFault({ diskId, attrId: "197", now: at(HOUR_MS) });
    ingestSmart(withoutFaults(SDB), at(2 * HOUR_MS));
    expect(activeAcceptances(diskId).has("197")).toBe(true);
  });
});

describe("SSD wear acceptance", () => {
  function diskOf(body: string) {
    const serial = JSON.parse(body).serial_number as string;
    return db.select().from(disk).where(eq(disk.serial, serial)).get()
      ?.id as number;
  }

  function withNvme(body: string, field: string, value: number) {
    const json = JSON.parse(body);
    json.nvme_smart_health_information_log[field] = value;
    return JSON.stringify(json);
  }

  function withNormalised(body: string, attrId: number, value: number) {
    const json = JSON.parse(body);
    const row = json.ata_smart_attributes.table.find(
      (candidate: { id: number }) => candidate.id === attrId,
    );
    row.value = value;
    row.worst = value;
    return JSON.stringify(json);
  }

  it("reopens accepted NVMe wear when it reaches failed", () => {
    const nvme = readFixture("mars/smartctl/xall-nvme0.json");
    ingestSmart(withNvme(nvme, "percentage_used", 85));
    const diskId = diskOf(nvme);
    expect(attribute(diskId, "percentage_used")?.status).toBe("warning");
    acceptFault({ diskId, attrId: "percentage_used", now: at(HOUR_MS) });

    ingestSmart(withNvme(nvme, "percentage_used", 90), at(2 * HOUR_MS));
    expect(activeAcceptances(diskId).has("percentage_used")).toBe(false);
  });

  it("reopens accepted ATA wear counting down when it reaches failed", () => {
    const ssd = readFixture("mars/smartctl/xall-sdo-auto.json");
    ingestSmart(withNormalised(ssd, 177, 15));
    const diskId = diskOf(ssd);
    expect(attribute(diskId, "177")?.status).toBe("warning");
    acceptFault({ diskId, attrId: "177", now: at(HOUR_MS) });

    ingestSmart(withNormalised(ssd, 177, 10), at(2 * HOUR_MS));
    expect(activeAcceptances(diskId).has("177")).toBe(true);

    ingestSmart(withNormalised(ssd, 177, 0), at(3 * HOUR_MS));
    expect(activeAcceptances(diskId).has("177")).toBe(false);
    expect(attribute(diskId, "177")?.status).toBe("failed");
  });
});

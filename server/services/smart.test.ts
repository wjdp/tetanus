import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { FULL_TEMPERATURE_DAYS } from "#shared/retention";
import { db } from "~~/server/database/client";
import {
  disk,
  selfTest,
  smartAttribute,
  smartReading,
  temperatureReading,
} from "~~/server/database/schema";
import { parse as parseSmartctl } from "~~/server/ingest/smartctl-xall";
import { addAutoEvent, listDiary } from "~~/server/services/diary";
import { type DiskRow, observeDisk } from "~~/server/services/disks";
import { upsertHostByName } from "~~/server/services/hosts";
import { recordIngest } from "~~/server/services/ingest";
import {
  downsample,
  evaluateMinimalReading,
  evaluateNamedAttributes,
  getSmartHistory,
  getSmartOverview,
  insertSmartReading,
  latestAttributes,
  MAX_HISTORY_POINTS,
  sctTemperaturePoints,
  trendDirection,
} from "~~/server/services/smart";
import { flushDb } from "~~/test/db";
import { readFixture } from "~~/test/fixtures";

const t0 = new Date("2026-09-01T10:00:00Z");
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const SDA = readFixture("mars/smartctl/xall-sda-auto.json");
const SDA_SERIAL = JSON.parse(SDA).serial_number as string;

function at(offsetMs: number) {
  return new Date(t0.getTime() + offsetMs);
}

function ingestSmart(body: string, receivedAt = t0, exitStatus = 0) {
  const outcome = recordIngest({
    hostName: "mars",
    source: "smartctl-xall",
    meta: { device: "/dev/sda", type: "sat", exitStatus },
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

function diskBySerial(serial: string): DiskRow {
  return db.select().from(disk).where(eq(disk.serial, serial)).get() as DiskRow;
}

function readingsOf(diskId: number) {
  return db
    .select()
    .from(smartReading)
    .where(eq(smartReading.diskId, diskId))
    .all();
}

function temperaturesOf(diskId: number) {
  return db
    .select()
    .from(temperatureReading)
    .where(eq(temperatureReading.diskId, diskId))
    .all();
}

function statusEvents(diskId: number) {
  return listDiary({ subjectType: "disk", subjectId: diskId }).filter(
    (entry) => entry.eventType === "smart-status-changed",
  );
}

beforeEach(() => {
  flushDb();
});

describe("recordSmartReading", () => {
  it("keeps the latest Seagate FARM log, and the last one when a reading has none", () => {
    const body = readFixture("mars/smartctl/xall-sdf-auto.json");
    ingestSmart(body);
    const serial = JSON.parse(body).serial_number;
    const farm = diskBySerial(serial).latestFarm;
    expect(farm).toMatchObject({ logVersion: "4.19", powerOnHours: 33091 });

    const withoutFarm = JSON.parse(body);
    withoutFarm.seagate_farm_log = { supported: true };
    ingestSmart(JSON.stringify(withoutFarm), at(HOUR_MS));
    const row = diskBySerial(serial);
    expect(row.latestFarm).toEqual(farm);
  });

  it("reports the drive's verdict apart from failing attributes", async () => {
    const { getDisk } = await import("~~/server/services/disks");
    const body = readFixture("mars/smartctl/xall-sdb-auto.json");
    ingestSmart(body);
    const row = diskBySerial(JSON.parse(body).serial_number);
    expect(row.latestStatus).toBe("failed");
    const { smartVerdict } = await getDisk(row.id);
    expect(smartVerdict?.drive).toBe("passed");
    expect(smartVerdict?.attributes.failed).toBeGreaterThan(0);
  });

  it("has no FARM log for other vendors", () => {
    const body = readFixture("mars/smartctl/xall-sda-auto.json");
    ingestSmart(body);
    const row = diskBySerial(JSON.parse(body).serial_number);
    expect(row.latestFarm).toBeNull();
  });

  it("stores a reading, its attributes and the latest fields", () => {
    const body = readFixture("mars/smartctl/xall-sdb-auto.json");
    ingestSmart(body);
    const row = diskBySerial(JSON.parse(body).serial_number);

    expect(row).toMatchObject({
      latestRaw: body,
      latestStatus: "failed",
      latestTemp: 41,
      latestPowerOnHours: 50434,
      latestReadingAt: t0,
    });
    expect(row.latestPowerCycles).toBe(JSON.parse(body).power_cycle_count);

    const [reading] = readingsOf(row.id);
    expect(reading).toMatchObject({
      devicePath: "/dev/sdb",
      deviceType: "sat",
      smartPassed: true,
      exitStatus: 0,
      deviceStatus: "failed",
      takenAt: t0,
    });
    const attributes = db
      .select()
      .from(smartAttribute)
      .where(eq(smartAttribute.readingId, reading.id))
      .all();
    expect(attributes).toHaveLength(18);
    expect(attributes.find((a) => a.attrId === "5")?.name).toBe(
      "Reallocated Sectors Count",
    );
    expect(attributes.find((a) => a.attrId === "197")).toMatchObject({
      status: "failed",
      transformedValue: 16,
    });
    expect(attributes.find((a) => a.attrId === "194")?.transformedValue).toBe(
      41,
    );
  });

  it("adds a reading per post without duplicating backfilled temperatures", () => {
    const later = at(30 * 60 * 1000);
    ingestSmart(SDA, t0);
    const diskId = diskBySerial(SDA_SERIAL).id;
    const afterFirst = temperaturesOf(diskId).length;
    ingestSmart(SDA, later);

    const history = parseSmartctl(SDA, {}).data.sctTemperatureHistory;
    const expectedAts = new Set(
      [
        t0,
        later,
        ...sctTemperaturePoints(history, t0).map((point) => point.at),
        ...sctTemperaturePoints(history, later).map((point) => point.at),
      ].map((date) => date.getTime()),
    );

    expect(readingsOf(diskId)).toHaveLength(2);
    expect(afterFirst).toBeGreaterThan(100);
    expect(temperaturesOf(diskId)).toHaveLength(expectedAts.size);
    expect(expectedAts.size).toBeLessThan(2 * afterFirst);
  });

  it("aligns SCT history to the interval with the newest entry last", () => {
    const points = sctTemperaturePoints(
      { intervalMinutes: 10, values: [30, null, 0, 33] },
      new Date("2026-09-01T10:07:30Z"),
    );
    expect(points).toEqual([
      { at: new Date("2026-09-01T09:30:00Z"), celsius: 30 },
      { at: new Date("2026-09-01T10:00:00Z"), celsius: 33 },
    ]);
  });

  it("drops SCT history older than the full-detail window", () => {
    const receivedAt = new Date("2026-09-01T00:00:00Z");
    const points = sctTemperaturePoints(
      { intervalMinutes: 24 * 60, values: Array(40).fill(30) },
      receivedAt,
    );
    expect(points).toHaveLength(FULL_TEMPERATURE_DAYS + 1);
    expect(points[0]?.at).toEqual(
      new Date(receivedAt.getTime() - FULL_TEMPERATURE_DAYS * DAY_MS),
    );
  });

  it("upserts self-tests on type and lifetime hours", () => {
    const body = readFixture("scrutiny/smart-ata.json");
    const entries = JSON.parse(body).ata_smart_self_test_log.standard.table;
    const distinct = new Set(
      entries.map(
        (entry: { type: { string: string }; lifetime_hours: number }) =>
          `${entry.type.string}@${entry.lifetime_hours}`,
      ),
    );
    ingestSmart(body, t0);
    ingestSmart(body, at(HOUR_MS));

    const rows = db.select().from(selfTest).all();
    expect(rows).toHaveLength(distinct.size);
    expect(rows.every((row) => row.seenAt.getTime() === t0.getTime())).toBe(
      true,
    );
    expect(rows[0]).toMatchObject({
      type: "Short offline",
      status: "Completed without error",
      passed: true,
    });
  });

  it("records a diary event when the status changes, not on the first reading", () => {
    ingestSmart(SDA, t0);
    const diskId = diskBySerial(SDA_SERIAL).id;
    expect(diskBySerial(SDA_SERIAL).latestStatus).toBe("passed");
    expect(statusEvents(diskId)).toHaveLength(0);

    ingestSmart(SDA, at(HOUR_MS));
    expect(statusEvents(diskId)).toHaveLength(0);

    ingestSmart(withAttributeRaw(SDA, 197, 16), at(2 * HOUR_MS));
    const [event] = statusEvents(diskId);
    expect(event).toMatchObject({
      title: "failed (was passed)",
      at: at(2 * HOUR_MS),
      data: { from: "passed", to: "failed", failing: ["197"], warning: [] },
    });
  });

  it("records attribute status changes against the previous reading", () => {
    ingestSmart(withAttributeRaw(SDA, 197, 16), t0);
    const diskId = diskBySerial(SDA_SERIAL).id;
    const attributeEvents = () =>
      listDiary({ subjectType: "disk", subjectId: diskId }).filter(
        (entry) => entry.eventType === "attribute-status-changed",
      );
    expect(attributeEvents()).toHaveLength(0);

    ingestSmart(withAttributeRaw(SDA, 197, 16), at(HOUR_MS));
    expect(attributeEvents()).toHaveLength(0);

    ingestSmart(SDA, at(2 * HOUR_MS));
    expect(attributeEvents()).toMatchObject([
      {
        title: "Current Pending Sector Count passed (was failed)",
        at: at(2 * HOUR_MS),
        data: {
          attrId: "197",
          name: "Current Pending Sector Count",
          from: "failed",
          to: "passed",
          value: 0,
        },
      },
    ]);
  });

  it("keeps the latest fields when an older reading arrives late", () => {
    ingestSmart(SDA, t0);
    ingestSmart(withAttributeRaw(SDA, 197, 16), at(-HOUR_MS));
    const row = diskBySerial(SDA_SERIAL);
    expect(row).toMatchObject({ latestStatus: "passed", latestReadingAt: t0 });
    expect(readingsOf(row.id)).toHaveLength(2);
    expect(statusEvents(row.id)).toHaveLength(0);
  });

  it("records ATA SSD attribute ids from the latest reading only", () => {
    const sdo = readFixture("mars/smartctl/xall-sdo-auto.json");
    const serial = JSON.parse(sdo).serial_number as string;
    const expected = {
      wear: "177",
      written: { attrId: "241", unitBytes: 512, inferred: true },
    };
    ingestSmart(sdo, t0);
    expect(diskBySerial(serial).ataSsdAttributes).toEqual(expected);

    db.update(disk).set({ ataSsdAttributes: null }).run();
    ingestSmart(sdo, at(-HOUR_MS));
    expect(diskBySerial(serial).ataSsdAttributes).toBeNull();

    ingestSmart(sdo, at(HOUR_MS));
    expect(diskBySerial(serial).ataSsdAttributes).toEqual(expected);
  });

  it("records no ATA SSD attributes for an HDD", () => {
    ingestSmart(SDA, t0);
    expect(diskBySerial(SDA_SERIAL).ataSsdAttributes).toBeNull();
  });

  it("observes a standby disk without recording a reading", () => {
    const standby = JSON.stringify({
      json_format_version: [1, 0],
      smartctl: { version: [7, 4], exit_status: 2 },
      device: { name: "/dev/sda", type: "sat", protocol: "ATA" },
      model_name: JSON.parse(SDA).model_name,
      serial_number: SDA_SERIAL,
    });
    ingestSmart(standby, t0, 2);
    const row = diskBySerial(SDA_SERIAL);
    expect(row.lastSeenAt).toEqual(t0);
    expect(row.latestReadingAt).toBeNull();
    expect(readingsOf(row.id)).toHaveLength(0);
  });
});

describe("history", () => {
  function seedDisk() {
    const hostRow = upsertHostByName("mars", t0);
    return observeDisk({
      hostId: hostRow.id,
      receivedAt: t0,
      keys: [{ kind: "model-serial", value: "M_S" }],
    }) as DiskRow;
  }

  it("downsamples to the last point per time bucket", () => {
    const points = Array.from({ length: 2000 }, (_, index) => ({
      at: at(index * 60 * 1000),
      value: index,
    }));
    const sampled = downsample(points);
    expect(sampled.length).toBeLessThanOrEqual(MAX_HISTORY_POINTS);
    expect(sampled.length).toBeGreaterThan(MAX_HISTORY_POINTS * 0.9);
    expect(sampled.at(-1)).toEqual(points.at(-1));
    expect(sampled[0].value).toBe(3);
    expect(sampled.map((point) => point.value)).toEqual(
      [...sampled.map((point) => point.value)].sort((a, b) => a - b),
    );
  });

  it("leaves short series alone", () => {
    const points = [{ at: t0 }, { at: at(1) }];
    expect(downsample(points)).toBe(points);
  });

  it("filters by range and caps every series", () => {
    const row = seedDisk();
    const now = at(8 * DAY_MS);
    const rows = Array.from({ length: 3000 }, (_, index) => ({
      diskId: row.id,
      at: at(index * 5 * 60 * 1000),
      celsius: 30 + (index % 10),
    }));
    db.insert(temperatureReading).values(rows).run();

    const week = getSmartHistory(row.id, "7d", now);
    expect(week.temperature.length).toBeLessThanOrEqual(MAX_HISTORY_POINTS);
    expect(week.temperature[0].at.getTime()).toBeGreaterThanOrEqual(
      now.getTime() - 7 * DAY_MS,
    );
    expect(week.temperature.at(-1)?.at).toEqual(rows.at(-1)?.at);
    const all = getSmartHistory(row.id, "all", now).temperature;
    expect(all[0].at.getTime()).toBeLessThan(at(HOUR_MS).getTime());
  });

  it("returns transformed attribute series", () => {
    ingestSmart(SDA, t0);
    ingestSmart(withAttributeRaw(SDA, 197, 4), at(HOUR_MS));
    const diskId = diskBySerial(SDA_SERIAL).id;
    const history = getSmartHistory(diskId, "30d", at(2 * HOUR_MS));
    expect(history.attributes["197"]).toEqual([
      { at: t0, value: 0 },
      { at: at(HOUR_MS), value: 4 },
    ]);
    expect(history.attributes["194"][0].value).toBe(40);
    expect(history.temperature.length).toBeGreaterThan(100);
  });

  it("lists self-tests and acceptances newest first in the overview", () => {
    ingestSmart(readFixture("scrutiny/smart-ata.json"), t0);
    const [row] = db.select().from(disk).all();
    const { selfTests, acceptances } = getSmartOverview(row.id, "30d", t0);
    const hours = selfTests.map((test) => test.lifetimeHours);
    expect(hours.length).toBeGreaterThan(1);
    expect(hours).toEqual([...hours].sort((a, b) => b - a));
    expect(acceptances).toEqual([]);
  });

  it("404s for an unknown disk", () => {
    expect(() => getSmartHistory(99999, "7d")).toThrow(/not found/);
    expect(() => getSmartOverview(99999, "7d")).toThrow(/not found/);
  });
});

describe("trend", () => {
  it("reads direction from the metadata ideal", () => {
    expect(trendDirection("low", 5, [])).toBe("new");
    expect(trendDirection("low", 5, [5, 5])).toBe("stable");
    expect(trendDirection("low", 6, [5])).toBe("worsening");
    expect(trendDirection("low", 4, [5, 6])).toBe("improving");
    expect(trendDirection("low", 5, [4, 6])).toBe("worsening");
    expect(trendDirection("high", 90, [100])).toBe("worsening");
    expect(trendDirection("high", 100, [90])).toBe("improving");
    expect(trendDirection("", 100, [1])).toBe("stable");
    expect(trendDirection("", 100, [])).toBe("new");
  });

  it("compares the latest reading with readings 7 and 30 days older", () => {
    ingestSmart(SDA, at(-40 * DAY_MS));
    ingestSmart(withAttributeRaw(SDA, 197, 2), at(-10 * DAY_MS));
    ingestSmart(withAttributeRaw(SDA, 197, 4), at(-DAY_MS));
    ingestSmart(withAttributeRaw(SDA, 197, 4), t0);
    const diskId = diskBySerial(SDA_SERIAL).id;

    const attributes = latestAttributes(diskId);
    expect(attributes).toHaveLength(18);
    const pending = attributes.find((a) => a.attrId === "197");
    expect(pending).toMatchObject({
      name: "Current Pending Sector Count",
      transformedValue: 4,
      trend: "worsening",
      metadata: {
        displayName: "Current Pending Sector Count",
        ideal: "low",
        critical: true,
      },
    });
    expect(attributes.find((a) => a.attrId === "9")?.trend).toBe("stable");
    expect(attributes.find((a) => a.attrId === "5")?.trend).toBe("stable");
    expect(
      attributes.find((a) => a.attrId === "194")?.metadata?.transformValueUnit,
    ).toBe("°C");
  });

  it("is new without an old enough reading", () => {
    ingestSmart(SDA, at(-DAY_MS));
    ingestSmart(SDA, t0);
    const diskId = diskBySerial(SDA_SERIAL).id;
    expect(
      new Set(latestAttributes(diskId).map((attribute) => attribute.trend)),
    ).toEqual(new Set(["new"]));
  });
});

describe("attribute row history", () => {
  function pendingOf(diskId: number) {
    return latestAttributes(diskId).find(
      (attribute) => attribute.attrId === "197",
    );
  }

  it("lists the five newest status changes and the time since the current status", () => {
    const raws = [0, 16, 0, 16, 0, 16, 0, 16];
    raws.forEach((raw, index) => {
      ingestSmart(withAttributeRaw(SDA, 197, raw), at(index * HOUR_MS));
    });
    const diskId = diskBySerial(SDA_SERIAL).id;
    addAutoEvent({
      subjectType: "disk",
      subjectId: diskId,
      eventType: "attribute-status-changed",
      title: "malformed",
      data: { attrId: "197", from: 1, to: "passed", value: 0 },
      at: at(10 * HOUR_MS),
    });

    const pending = pendingOf(diskId);
    expect(pending?.status).toBe("failed");
    expect(pending?.statusChanges).toEqual(
      [7, 6, 5, 4, 3].map((index) => ({
        at: at(index * HOUR_MS),
        from: index % 2 ? "passed" : "failed",
        to: index % 2 ? "failed" : "passed",
        value: raws[index],
      })),
    );
    expect(pending?.statusSince).toEqual(at(7 * HOUR_MS));
    expect(
      latestAttributes(diskId).find((attribute) => attribute.attrId === "5")
        ?.statusChanges,
    ).toEqual([]);
  });

  it("has no status since without a change", () => {
    ingestSmart(SDA, t0);
    ingestSmart(SDA, at(HOUR_MS));
    const pending = pendingOf(diskBySerial(SDA_SERIAL).id);
    expect(pending?.statusChanges).toEqual([]);
    expect(pending?.statusSince).toBeNull();
  });

  it("dates the current value from the start of its unbroken run", () => {
    ingestSmart(withAttributeRaw(SDA, 197, 4), t0);
    ingestSmart(withAttributeRaw(SDA, 197, 4), at(HOUR_MS));
    ingestSmart(withAttributeRaw(SDA, 197, 2), at(2 * HOUR_MS));
    ingestSmart(withAttributeRaw(SDA, 197, 4), at(3 * HOUR_MS));
    ingestSmart(withAttributeRaw(SDA, 197, 4), at(4 * HOUR_MS));
    const diskId = diskBySerial(SDA_SERIAL).id;

    const attributes = latestAttributes(diskId);
    expect(pendingOf(diskId)?.valueSince).toEqual(at(3 * HOUR_MS));
    expect(
      attributes.find((attribute) => attribute.attrId === "5")?.valueSince,
    ).toEqual(t0);
  });

  it("dates the first non-zero reading", () => {
    ingestSmart(SDA, t0);
    ingestSmart(withAttributeRaw(SDA, 197, 2), at(HOUR_MS));
    ingestSmart(SDA, at(2 * HOUR_MS));
    const diskId = diskBySerial(SDA_SERIAL).id;

    const attributes = latestAttributes(diskId);
    expect(pendingOf(diskId)?.firstNonZeroAt).toEqual(at(HOUR_MS));
    expect(
      attributes.find((attribute) => attribute.attrId === "5")?.firstNonZeroAt,
    ).toBeNull();
  });
});

describe("evaluateMinimalReading", () => {
  it("evaluates ATA attributes as the collector path does", () => {
    const parsed = parseSmartctl(
      readFixture("mars/smartctl/xall-sdb-auto.json"),
      {},
    ).data;
    const minimal = evaluateMinimalReading({
      protocol: "ATA",
      attributes: (parsed.ata?.attributes ?? []).map((attribute) => ({
        id: String(attribute.id),
        value: attribute.value,
        worst: attribute.worst,
        thresh: attribute.thresh,
        rawValue: attribute.raw.value,
        rawString: attribute.raw.string,
        whenFailed: attribute.whenFailed,
      })),
      temperature: parsed.temperature,
    });

    const strip = ({ name: _name, ...attribute }: { name: string }) =>
      attribute;
    expect(minimal.attributes.map(strip)).toEqual(
      evaluateNamedAttributes(parsed).map(strip),
    );
    expect(minimal.deviceStatus).toBe("failed");
    expect(minimal.temp).toBe(41);
  });

  it("names ATA attributes from our metadata", () => {
    const { attributes } = evaluateMinimalReading({
      protocol: "ATA",
      attributes: [
        { id: "197", value: 100, worst: 100, thresh: 0, rawValue: 16 },
      ],
    });
    expect(attributes[0]).toMatchObject({
      attrId: "197",
      name: "Current Pending Sector Count",
      status: "failed",
    });
  });

  it("evaluates NVMe attributes by name", () => {
    const { attributes, deviceStatus } = evaluateMinimalReading({
      protocol: "NVMe",
      attributes: [
        { id: "media_errors", value: 3, thresh: 0 },
        { id: "available_spare", value: 5, thresh: 10 },
        { id: "percentage_used", value: 2, thresh: 100 },
      ],
    });
    expect(
      Object.fromEntries(attributes.map((a) => [a.attrId, a.status])),
    ).toEqual({
      media_errors: "failed",
      available_spare: "failed",
      percentage_used: "passed",
    });
    expect(deviceStatus).toBe("failed");
  });

  it("evaluates SCSI counters by name", () => {
    const { attributes } = evaluateMinimalReading({
      protocol: "SCSI",
      attributes: [
        { id: "scsi_grown_defect_list", value: 0 },
        { id: "read_total_uncorrected_errors", value: 2 },
      ],
    });
    expect(
      Object.fromEntries(attributes.map((a) => [a.attrId, a.status])),
    ).toMatchObject({
      scsi_grown_defect_list: "passed",
      read_total_uncorrected_errors: "failed",
    });
  });

  it("is unknown without attributes", () => {
    expect(
      evaluateMinimalReading({ protocol: "NVMe", attributes: [] }).deviceStatus,
    ).toBe("unknown");
  });
});

describe("imported history", () => {
  it("marks imported attribute points and reports the newest import", () => {
    ingestSmart(SDA, t0);
    const row = diskBySerial(SDA_SERIAL);
    const importedAt = new Date(t0.getTime() - 2 * DAY_MS);
    const { attributes, deviceStatus } = evaluateMinimalReading({
      protocol: "ATA",
      attributes: [
        { id: "197", value: 100, worst: 100, thresh: 0, rawValue: 0 },
      ],
    });
    insertSmartReading(
      {
        diskId: row.id,
        hostId: row.lastSeenHostId as number,
        takenAt: importedAt,
        devicePath: "/dev/sda",
        deviceStatus,
        source: "scrutiny",
      },
      attributes,
    );

    const history = getSmartHistory(row.id, "30d", at(HOUR_MS));

    expect(history.attributes["197"]).toEqual([
      { at: importedAt, value: 0, source: "scrutiny" },
      { at: t0, value: 0 },
    ]);
    expect(history.importedUntil).toEqual(importedAt);
    expect(getSmartHistory(row.id, "7d", at(10 * DAY_MS)).importedUntil).toBe(
      null,
    );
  });
});

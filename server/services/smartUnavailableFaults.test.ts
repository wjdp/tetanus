import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "~~/server/database/client";
import { disk, fault } from "~~/server/database/schema";
import { parse } from "~~/server/ingest/smartctl-xall";
import { listDisks } from "~~/server/services/disks";
import {
  type FaultRow,
  performFaultAction,
  syncFaults,
} from "~~/server/services/faults";
import { recordIngest } from "~~/server/services/ingest";
import { detectSmartUnavailable } from "~~/server/services/smartUnavailableFaults";
import { flushDb } from "~~/test/db";
import { readFixture } from "~~/test/fixtures";

vi.mock("~~/server/ingest/smartctl-xall", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("~~/server/ingest/smartctl-xall")>();
  return { ...original, parse: vi.fn(original.parse) };
});

const t0 = new Date("2026-09-01T10:00:00Z");
const MINUTE_MS = 60 * 1000;
const HEALTHY = readFixture("mars/smartctl/xall-sdb-auto.json");
const SERIAL = JSON.parse(HEALTHY).serial_number as string;
const COMMAND_FAILED = 4;
const DEVICE_OPEN_FAILED = 2;

const at = (offsetMs: number) => new Date(t0.getTime() + offsetMs);

function withoutSmartData(edit: (json: Record<string, unknown>) => void) {
  const json = JSON.parse(HEALTHY) as Record<string, unknown>;
  for (const key of Object.keys(json)) {
    if (key.startsWith("ata_smart") || key.startsWith("ata_sct")) {
      delete json[key];
    }
  }
  delete json.smart_status;
  edit(json);
  return JSON.stringify(json);
}

const UNSUPPORTED = withoutSmartData((json) => {
  json.smart_support = { available: false };
});
const DISABLED = withoutSmartData((json) => {
  json.smart_support = { available: true, enabled: false };
});
const UNREADABLE = withoutSmartData((json) => {
  delete json.smart_support;
});

function ingest(body: string, offsetMs: number, exitStatus = 0) {
  const outcome = recordIngest({
    hostName: "nas",
    source: "smartctl-xall",
    meta: { device: "/dev/sdb", type: "sat", exitStatus },
    body,
    receivedAt: at(offsetMs),
  });
  expect(outcome.ok).toBe(true);
}

async function read(body: string, offsetMs: number, exitStatus = 0) {
  ingest(body, offsetMs, exitStatus);
  await syncFaults(at(offsetMs));
}

const diskId = () =>
  (
    db
      .select({ id: disk.id })
      .from(disk)
      .where(eq(disk.serial, SERIAL))
      .get() as { id: number }
  ).id;

function liveFault(): FaultRow | undefined {
  return db
    .select()
    .from(fault)
    .where(eq(fault.kind, "smart-unavailable"))
    .all()
    .find((row) => row.key === String(diskId()) && !row.resolvedAt);
}

beforeEach(() => {
  flushDb();
  vi.mocked(parse).mockClear();
});

describe("smart-unavailable", () => {
  it.each([
    ["unsupported", UNSUPPORTED, 0],
    ["disabled", DISABLED, 0],
    ["unreadable", UNREADABLE, COMMAND_FAILED],
  ] as const)(
    "raises a warning when SMART is %s",
    async (reason, body, exitStatus) => {
      await read(body, 0, exitStatus);
      expect(liveFault()).toMatchObject({
        state: "open",
        severity: "warning",
        subjectId: diskId(),
        data: { reason },
      });
    },
  );

  it("does not call an empty reading unreadable without the command-failed bit", async () => {
    await read(UNREADABLE, 0);
    expect(liveFault()).toBeUndefined();
  });

  it("never raises for a standby reading", async () => {
    await read(UNREADABLE, 0, DEVICE_OPEN_FAILED);
    expect(liveFault()).toBeUndefined();

    await read(HEALTHY, MINUTE_MS);
    await read(UNREADABLE, 2 * MINUTE_MS, DEVICE_OPEN_FAILED);
    expect(liveFault()).toBeUndefined();
  });

  it("resolves when a reading with usable data arrives", async () => {
    await read(UNREADABLE, 0, COMMAND_FAILED);
    expect(liveFault()).toBeDefined();
    await read(HEALTHY, MINUTE_MS);
    expect(liveFault()).toBeUndefined();
  });

  it("ignores disks that are out of service", async () => {
    ingest(DISABLED, 0);
    const [row] = await listDisks(at(0));
    expect(detectSmartUnavailable({ disks: [row] })).toHaveLength(1);
    expect(
      detectSmartUnavailable({ disks: [{ ...row, state: "retired" }] }),
    ).toEqual([]);
  });

  it("holds once accepted and reopens when the reason changes", async () => {
    await read(UNSUPPORTED, 0);
    performFaultAction((liveFault() as FaultRow).id, "accept", {
      now: at(MINUTE_MS),
    });
    await read(UNSUPPORTED, 2 * MINUTE_MS);
    expect(liveFault()).toMatchObject({ state: "accepted" });

    await read(DISABLED, 3 * MINUTE_MS);
    expect(liveFault()).toMatchObject({
      state: "open",
      data: { reason: "disabled" },
    });
  });

  it("neither raises for nor parses a healthy disk", async () => {
    ingest(HEALTHY, 0);
    const disks = await listDisks(at(0));
    vi.mocked(parse).mockClear();
    expect(detectSmartUnavailable({ disks })).toEqual([]);
    expect(parse).not.toHaveBeenCalled();
  });
});

import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { DiaryEventType } from "#shared/diary";
import type { VdevRole } from "#shared/zfsState";
import { db } from "~~/server/database/client";
import {
  diaryEntry,
  disk,
  fault,
  pool,
  smartReading,
  vdev,
} from "~~/server/database/schema";
import { acceptFault } from "~~/server/services/acceptance";
import { addAutoEvent } from "~~/server/services/diary";
import { type FaultRow, syncFaults } from "~~/server/services/faults";
import { backfillFaults } from "~~/server/services/faultsBackfill";
import { upsertHostByName } from "~~/server/services/hosts";
import { recordIngest } from "~~/server/services/ingest";
import { getSettings } from "~~/server/services/settings";
import { flushDb } from "~~/test/db";
import { readFixture } from "~~/test/fixtures";

const t0 = new Date("2026-09-01T10:00:00Z");
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const SDB = readFixture("mars/smartctl/xall-sdb-auto.json");
const SDB_SERIAL = JSON.parse(SDB).serial_number as string;

function at(offsetMs: number) {
  return new Date(t0.getTime() + offsetMs);
}

function withAttributeRaw(body: string, attrId: number, raw: number) {
  const json = JSON.parse(body);
  const attribute = json.ata_smart_attributes.table.find(
    (row: { id: number }) => row.id === attrId,
  );
  attribute.raw = { value: raw, string: String(raw) };
  return JSON.stringify(json);
}

function event(
  subjectType: "disk" | "pool" | "host" | "vdev",
  subjectId: number,
  eventType: DiaryEventType,
  data: Record<string, unknown>,
  offsetMs: number,
) {
  addAutoEvent({
    subjectType,
    subjectId,
    eventType,
    title: eventType,
    data,
    at: at(offsetMs),
  });
}

function faultEvent(
  subject: { type: "disk" | "pool" | "host"; id: number },
  eventType: "fault-state-changed" | "fault-resolved",
  data: { kind: string; key: string; from: string; to: string; note: string },
  offsetMs: number,
) {
  event(subject.type, subject.id, eventType, { faultId: 0, ...data }, offsetMs);
}

function insertDisk(alias: string, state: "spare" | "dead") {
  return db
    .insert(disk)
    .values({ alias, lastSeenAt: t0, lastState: state, stateOverride: state })
    .returning()
    .get().id;
}

function insertReading(
  diskId: number,
  hostId: number,
  smartPassed: boolean,
  offsetMs: number,
) {
  db.insert(smartReading)
    .values({
      diskId,
      hostId,
      takenAt: at(offsetMs),
      devicePath: "/dev/sdc",
      smartPassed,
      exitStatus: smartPassed ? 0 : 8,
      deviceStatus: smartPassed ? "passed" : "failed",
    })
    .run();
}

function faultRows() {
  return db.select().from(fault).orderBy(fault.id).all();
}

function withoutIds(rows: FaultRow[]) {
  return rows.map(({ id: _id, ...row }) => row);
}

function only(kind: FaultRow["kind"]) {
  const rows = faultRows().filter((row) => row.kind === kind);
  expect(rows).toHaveLength(1);
  return rows[0];
}

function diaryCount() {
  return db.select().from(diaryEntry).all().length;
}

beforeEach(() => {
  flushDb();
});

describe("backfillFaults", () => {
  it("replays each kind from the diary and SMART readings with real timestamps", async () => {
    const mars = upsertHostByName("mars", t0);
    const a = insertDisk("A1", "spare");
    const b = insertDisk("B1", "dead");
    const vault = db
      .insert(pool)
      .values({
        hostId: mars.id,
        guid: "123",
        name: "vault",
        state: "ONLINE",
        firstSeenAt: t0,
        lastSeenAt: t0,
      })
      .returning()
      .get().id;
    const attribute = { attrId: "197", name: "Current Pending Sector Count" };

    event(
      "disk",
      a,
      "attribute-status-changed",
      { ...attribute, from: "passed", to: "warning", value: 1 },
      HOUR_MS,
    );
    event(
      "disk",
      a,
      "fault-acknowledged",
      { attrId: "197", acceptedValue: 1, note: "watching" },
      2 * HOUR_MS,
    );
    event(
      "disk",
      a,
      "acknowledgement-superseded",
      { attrId: "197", acceptedValue: 1, value: 5 },
      3 * HOUR_MS,
    );
    event(
      "disk",
      a,
      "attribute-status-changed",
      { ...attribute, from: "warning", to: "failed", value: 5 },
      3 * HOUR_MS,
    );
    event(
      "disk",
      a,
      "attribute-status-changed",
      { ...attribute, from: "failed", to: "passed", value: 0 },
      4 * HOUR_MS,
    );

    event("disk", a, "state-changed", { from: "spare", to: "missing" }, DAY_MS);
    event(
      "disk",
      a,
      "state-changed",
      { from: "missing", to: "spare" },
      2 * DAY_MS,
    );

    event("disk", a, "identity-conflict", { diskIds: [b, a] }, HOUR_MS);
    const conflictKey = `${a}:${Math.min(a, b)},${Math.max(a, b)}`;
    faultEvent(
      { type: "disk", id: a },
      "fault-resolved",
      {
        kind: "identity-conflict",
        key: conflictKey,
        from: "open",
        to: "resolved",
        note: "same disk",
      },
      2 * HOUR_MS,
    );

    event(
      "pool",
      vault,
      "pool-state-changed",
      { from: "ONLINE", to: "DEGRADED" },
      HOUR_MS,
    );
    faultEvent(
      { type: "pool", id: vault },
      "fault-state-changed",
      {
        kind: "pool-degraded",
        key: String(vault),
        from: "open",
        to: "accepted",
        note: "leaf offline",
      },
      90 * MINUTE_MS,
    );
    event(
      "pool",
      vault,
      "pool-state-changed",
      { from: "DEGRADED", to: "FAULTED" },
      2 * HOUR_MS,
    );
    event(
      "pool",
      vault,
      "pool-state-changed",
      { from: "FAULTED", to: "ONLINE" },
      3 * HOUR_MS,
    );

    event(
      "pool",
      vault,
      "scrub-finished",
      { function: "SCRUB", errors: 2 },
      HOUR_MS,
    );
    event(
      "pool",
      vault,
      "scrub-finished",
      { function: "SCRUB", errors: 0 },
      5 * HOUR_MS,
    );

    event(
      "host",
      mars.id,
      "collector-status-changed",
      { from: "outdated", to: "incompatible", version: "0.1.0" },
      HOUR_MS,
    );
    event(
      "host",
      mars.id,
      "collector-status-changed",
      { from: "incompatible", to: "current", version: "0.4.0" },
      2 * HOUR_MS,
    );

    insertReading(b, mars.id, true, HOUR_MS);
    insertReading(b, mars.id, false, 2 * HOUR_MS);
    insertReading(b, mars.id, false, 3 * HOUR_MS);
    event("disk", b, "override-set", { from: null, to: "dead" }, 4 * HOUR_MS);
    insertReading(b, mars.id, false, 5 * HOUR_MS);

    const now = at(10 * DAY_MS);
    const diaryBefore = diaryCount();
    await backfillFaults(now);

    expect(
      faultRows().filter((row) => row.kind === "smart-attribute"),
    ).toMatchObject([
      {
        key: `${a}:197`,
        severity: "error",
        state: "resolved",
        openedAt: at(HOUR_MS),
        stateChangedAt: at(4 * HOUR_MS),
        resolvedAt: at(4 * HOUR_MS),
        note: "",
        data: { attrId: "197", value: 5 },
      },
    ]);
    expect(only("disk-missing")).toMatchObject({
      key: String(a),
      openedAt: at(DAY_MS),
      resolvedAt: at(2 * DAY_MS),
      data: { lastSeenAt: t0.toISOString() },
    });
    expect(only("identity-conflict")).toMatchObject({
      key: conflictKey,
      state: "resolved",
      openedAt: at(HOUR_MS),
      resolvedAt: at(2 * HOUR_MS),
      note: "same disk",
    });
    expect(only("pool-degraded")).toMatchObject({
      severity: "error",
      state: "resolved",
      openedAt: at(HOUR_MS),
      lastSeenAt: at(2 * HOUR_MS),
      resolvedAt: at(3 * HOUR_MS),
      note: "",
      data: { state: "FAULTED", poolName: "vault" },
    });
    expect(only("pool-data-errors")).toMatchObject({
      openedAt: at(HOUR_MS),
      resolvedAt: at(5 * HOUR_MS),
      data: { scanErrors: 2, function: "SCRUB", poolName: "vault" },
    });
    expect(only("collector-incompatible")).toMatchObject({
      key: `${mars.id}:0.1.0`,
      openedAt: at(HOUR_MS),
      resolvedAt: at(2 * HOUR_MS),
    });
    expect(only("smart-health-failed")).toMatchObject({
      key: String(b),
      openedAt: at(2 * HOUR_MS),
      lastSeenAt: at(3 * HOUR_MS),
      resolvedAt: at(4 * HOUR_MS),
      data: { readingAt: at(3 * HOUR_MS).toISOString() },
    });
    expect(only("collector-silent")).toMatchObject({
      state: "open",
      openedAt: now,
    });

    expect(diaryCount()).toBe(diaryBefore + 1);
    expect((await getSettings()).config.faultsBackfilledAt).toBe(
      now.toISOString(),
    );
  });

  it("replays leaf states, leaf errors and data errors into the ZFS kinds", async () => {
    const mars = upsertHostByName("mars", t0);
    const vault = db
      .insert(pool)
      .values({
        hostId: mars.id,
        guid: "123",
        name: "vault",
        state: "ONLINE",
        firstSeenAt: t0,
        lastSeenAt: t0,
      })
      .returning()
      .get().id;
    const leaf = (guid: string, name: string, role: VdevRole = "normal") =>
      db
        .insert(vdev)
        .values({
          poolId: vault,
          guid,
          name,
          type: "disk",
          role,
          state: "ONLINE",
          lastSeenAt: t0,
        })
        .returning()
        .get().id;
    const cache = leaf("21", "C1", "cache");
    const a7 = leaf("31", "A7");
    const errors = (from: number, to: number, offsetMs: number) =>
      event(
        "pool",
        vault,
        "leaf-errors-changed",
        {
          poolId: vault,
          vdevGuid: "31",
          leaf: "A7",
          role: "normal",
          diskId: null,
          from: { read: 0, write: 0, checksum: from },
          to: { read: 0, write: 0, checksum: to },
        },
        offsetMs,
      );

    event(
      "vdev",
      cache,
      "vdev-state-changed",
      { poolId: vault, poolState: "ONLINE", from: "ONLINE", to: "UNAVAIL" },
      HOUR_MS,
    );
    event(
      "vdev",
      cache,
      "vdev-state-changed",
      { poolId: vault, poolState: "ONLINE", from: "UNAVAIL", to: "ONLINE" },
      2 * HOUR_MS,
    );
    errors(0, 4, HOUR_MS);
    faultEvent(
      { type: "pool", id: vault },
      "fault-state-changed",
      {
        kind: "leaf-errors",
        key: `${vault}:31`,
        from: "open",
        to: "acknowledged",
        note: "watching",
      },
      2 * HOUR_MS,
    );
    errors(4, 6, 3 * HOUR_MS);
    event(
      "vdev",
      a7,
      "vdev-left",
      { poolId: vault, lastState: "ONLINE" },
      4 * HOUR_MS,
    );
    event(
      "pool",
      vault,
      "pool-data-errors-changed",
      { from: 0, to: 2 },
      HOUR_MS,
    );
    event(
      "pool",
      vault,
      "scrub-finished",
      { function: "SCRUB", errors: 0 },
      5 * HOUR_MS,
    );

    await backfillFaults(at(10 * DAY_MS));

    expect(only("pool-degraded")).toMatchObject({
      severity: "error",
      openedAt: at(HOUR_MS),
      resolvedAt: at(2 * HOUR_MS),
      data: {
        state: "ONLINE",
        leaves: [
          { vdevGuid: "21", name: "C1", role: "cache", state: "UNAVAIL" },
        ],
      },
    });
    expect(only("leaf-errors")).toMatchObject({
      severity: "warning",
      state: "resolved",
      openedAt: at(HOUR_MS),
      stateChangedAt: at(4 * HOUR_MS),
      resolvedAt: at(4 * HOUR_MS),
      data: { checksum: 6, total: { checksum: 6 } },
    });
    expect(only("pool-data-errors")).toMatchObject({
      openedAt: at(HOUR_MS),
      resolvedAt: at(5 * HOUR_MS),
      data: { dataErrors: 2 },
    });

    const first = withoutIds(faultRows());
    await backfillFaults(at(10 * DAY_MS));
    expect(withoutIds(faultRows())).toEqual(first);
  });

  it("replays kinds with no trail of their own at their recorded severity", async () => {
    const mars = upsertHostByName("mars", t0);
    const poolId = db
      .insert(pool)
      .values({
        hostId: mars.id,
        guid: "1",
        name: "vault",
        state: "ONLINE",
        firstSeenAt: t0,
        lastSeenAt: t0,
      })
      .returning()
      .get().id;
    const statusKey = `${poolId}:ZFS-8000-K4`;
    const opened = (kind: string, key: string, extra = {}) => ({
      faultId: 0,
      kind,
      key,
      ...extra,
    });
    event(
      "pool",
      poolId,
      "fault-opened",
      opened("pool-status", statusKey, { severity: "error" }),
      0,
    );
    event(
      "pool",
      poolId,
      "fault-resolved",
      opened("pool-status", statusKey),
      HOUR_MS,
    );
    event(
      "pool",
      poolId,
      "fault-opened",
      opened("scan-stalled", String(poolId)),
      2 * HOUR_MS,
    );
    event(
      "pool",
      poolId,
      "fault-resolved",
      opened("scan-stalled", String(poolId)),
      3 * HOUR_MS,
    );

    await backfillFaults(at(4 * HOUR_MS));

    expect(only("pool-status")).toMatchObject({
      severity: "error",
      state: "resolved",
      data: { msgid: "ZFS-8000-K4" },
    });
    expect(only("scan-stalled")).toMatchObject({
      severity: "warning",
      state: "resolved",
    });
  });

  it("reproduces what live sync recorded, and a re-run gives the same rows", async () => {
    const passing = withAttributeRaw(withAttributeRaw(SDB, 198, 0), 197, 0);
    const ingest = async (body: string, offsetMs: number) => {
      const outcome = recordIngest({
        hostName: "mars",
        source: "smartctl-xall",
        meta: { device: "/dev/sdb", type: "sat", exitStatus: 0 },
        body,
        receivedAt: at(offsetMs),
      });
      expect(outcome.ok).toBe(true);
      await syncFaults(at(offsetMs));
    };

    await ingest(passing, 0);
    await ingest(withAttributeRaw(passing, 197, 16), HOUR_MS);
    const diskId = (
      db
        .select({ id: disk.id })
        .from(disk)
        .where(eq(disk.serial, SDB_SERIAL))
        .get() as { id: number }
    ).id;
    acceptFault({
      diskId,
      attrId: "197",
      kind: "acknowledge",
      note: "watching",
      now: at(2 * HOUR_MS),
    });
    await ingest(withAttributeRaw(passing, 197, 16), 3 * HOUR_MS);

    const live = faultRows();
    expect(live.find((row) => row.kind === "smart-attribute")).toMatchObject({
      state: "acknowledged",
      openedAt: at(HOUR_MS),
      stateChangedAt: at(2 * HOUR_MS),
      note: "watching",
    });

    await backfillFaults(at(3 * HOUR_MS));
    const first = faultRows();
    expect(withoutIds(first)).toEqual(withoutIds(live));

    const diaryAfterFirst = diaryCount();
    await backfillFaults(at(3 * HOUR_MS));
    expect(withoutIds(faultRows())).toEqual(withoutIds(first));
    expect(diaryCount()).toBe(diaryAfterFirst);
  });
});

import { describe, expect, it } from "vitest";
import {
  type AlertContext,
  deriveAlert,
  deriveAlerts,
} from "~~/server/services/alerts/rules";
import type { DiaryEntryRow } from "~~/server/services/diary";

const at = new Date("2026-09-01T10:00:00Z");

function entry(
  eventType: string,
  data: Record<string, unknown>,
  overrides: Partial<DiaryEntryRow> = {},
): DiaryEntryRow {
  return {
    id: 7,
    subjectType: "disk",
    subjectId: 3,
    at,
    kind: "auto",
    eventType,
    title: `${eventType} title`,
    body: "",
    data,
    ...overrides,
  };
}

const poolEntry = (eventType: string, data: Record<string, unknown>) =>
  entry(eventType, data, { subjectType: "pool", subjectId: 5 });

const vdevEntry = (data: Record<string, unknown>) =>
  entry("vdev-state-changed", data, {
    subjectType: "vdev",
    subjectId: 11,
    title: "C1 UNAVAIL (was ONLINE)",
  });

const hostEntry = (from: string, to: string, version = "0.2.0") =>
  entry(
    "collector-status-changed",
    { from, to, version, minVersion: "0.3.0" },
    { subjectType: "host", subjectId: 1 },
  );

const context: AlertContext = {
  disk: (id) =>
    id === 3
      ? {
          alias: "K2",
          model: "WDC WD80",
          serial: "ABC",
          hostName: "mars",
          disposal: null,
        }
      : id === 4
        ? {
            alias: "K4",
            model: "WDC WD80",
            serial: "DEF",
            hostName: "mars",
            disposal: { kind: "rma", on: "2026-10-02" },
          }
        : undefined,
  pool: (id) =>
    id === 5
      ? { name: "tank", hostName: "mars", archived: false }
      : id === 6
        ? { name: "tfault", hostName: "mars", archived: true }
        : undefined,
  host: (id) => (id === 1 ? { name: "mars" } : undefined),
  replication: (id) =>
    id === 5
      ? { label: "tank/a → vpool/tank/a", hostName: "vault", archived: false }
      : id === 6
        ? { label: "zeta/p → vpool/zeta/p", hostName: "vault", archived: true }
        : undefined,
  hasActiveAcceptance: (diskId, attrId) => diskId === 3 && attrId === "5",
};

const failedPending = entry("attribute-status-changed", {
  attrId: "197",
  name: "Current Pending Sector Count",
  from: "passed",
  to: "failed",
  value: 16,
});

describe("deriveAlert", () => {
  it.each([
    ["attribute failed", failedPending, "attribute-failed", "197"],
    [
      "accepted fault superseded",
      entry("acceptance-superseded", {
        attrId: "5",
        acceptedValue: 8,
        value: 12,
      }),
      "acceptance-superseded",
      "5@12",
    ],
    [
      "acknowledged fault superseded",
      entry("acknowledgement-superseded", {
        attrId: "197",
        acceptedValue: 16,
        value: 17,
      }),
      "acknowledgement-superseded",
      "197@17",
    ],
    [
      "SMART failed",
      entry("smart-status-changed", { from: "passed", to: "failed" }),
      "disk-failed",
      "failed",
    ],
    [
      "SMART recovered",
      entry("smart-status-changed", { from: "failed", to: "warning" }),
      "disk-recovered",
      "warning",
    ],
    [
      "disk missing",
      entry("state-changed", { from: "in-use", to: "missing" }),
      "disk-missing",
      "missing",
    ],
    [
      "disk back in use",
      entry("state-changed", { from: "missing", to: "in-use" }),
      "disk-reappeared",
      "in-use",
    ],
    [
      "disk back as spare",
      entry("state-changed", { from: "missing", to: "spare" }),
      "disk-reappeared",
      "spare",
    ],
    [
      "pool degraded",
      poolEntry("pool-state-changed", { from: "ONLINE", to: "DEGRADED" }),
      "pool-degraded",
      "DEGRADED",
    ],
    [
      "pool recovered",
      poolEntry("pool-state-changed", { from: "DEGRADED", to: "ONLINE" }),
      "pool-recovered",
      "ONLINE",
    ],
    [
      "scrub errors",
      poolEntry("scrub-finished", { function: "SCRUB", errors: 3 }),
      "pool-data-errors",
      "scan:3",
    ],
    [
      "resilver errors",
      poolEntry("resilver-finished", { function: "RESILVER", errors: 1 }),
      "pool-data-errors",
      "scan:1",
    ],
    [
      "permanent data errors",
      poolEntry("pool-data-errors-changed", { from: 0, to: 2 }),
      "pool-data-errors",
      "data:2",
    ],
    [
      "leaf errors",
      poolEntry("leaf-errors-changed", {
        vdevGuid: "77",
        from: { read: 0, write: 0, checksum: 0 },
        to: { read: 0, write: 0, checksum: 12 },
      }),
      "leaf-errors",
      "77:0/0/12",
    ],
    [
      "a missing pool",
      poolEntry("fault-opened", {
        faultId: 1,
        kind: "pool-missing",
        key: "5",
      }),
      "pool-missing",
      "5",
    ],
    [
      "an overdue scrub",
      poolEntry("fault-opened", {
        faultId: 2,
        kind: "scrub-overdue",
        key: "5",
      }),
      "scrub-overdue",
      "5",
    ],
    [
      "slow I/Os",
      poolEntry("fault-opened", {
        faultId: 3,
        kind: "leaf-slow",
        key: "5:77",
      }),
      "leaf-slow",
      "5:77",
    ],
    [
      "a pool status message",
      poolEntry("fault-opened", {
        faultId: 4,
        kind: "pool-status",
        key: "5:ZFS-8000-EY",
      }),
      "pool-status",
      "5:ZFS-8000-EY",
    ],
    [
      "a paused scrub",
      poolEntry("fault-opened", {
        faultId: 5,
        kind: "scrub-paused",
        key: "5",
      }),
      "scrub-paused",
      "5",
    ],
    [
      "a stalled scan",
      poolEntry("fault-opened", {
        faultId: 6,
        kind: "scan-stalled",
        key: "5",
      }),
      "scan-stalled",
      "5",
    ],
    [
      "a single-device special vdev",
      poolEntry("fault-opened", {
        faultId: 7,
        kind: "vdev-unredundant",
        key: "5:88",
      }),
      "vdev-unredundant",
      "5:88",
    ],
    [
      "a disk running hot",
      entry("fault-opened", { faultId: 8, kind: "temperature-high", key: "3" }),
      "temperature-high",
      "3",
    ],
    [
      "a hot disk raised to error",
      entry("fault-severity-raised", {
        faultId: 8,
        kind: "temperature-high",
        key: "3",
        severity: "error",
      }),
      "temperature-high",
      "3@error",
    ],
    [
      "identity conflict",
      entry("identity-conflict", { diskIds: [3, 9], keys: [] }),
      "identity-conflict",
      "3,9",
    ],
    [
      "collector incompatible",
      hostEntry("current", "incompatible"),
      "collector-incompatible",
      "0.2.0",
    ],
    [
      "collector compatible again",
      hostEntry("incompatible", "outdated", "0.3.0"),
      "collector-compatible",
      "0.3.0",
    ],
  ])("maps %s", (_, diaryEntry, rule, value) => {
    const alert = deriveAlert(diaryEntry, context);
    expect(alert?.rule).toBe(rule);
    expect(alert?.dedupeKey).toBe(
      `${rule}:${diaryEntry.subjectType}:${diaryEntry.subjectId}:${value}:7`,
    );
  });

  it.each([
    [
      "an attribute warning",
      entry("attribute-status-changed", { attrId: "197", to: "warning" }),
    ],
    [
      "an accepted attribute failing",
      entry("attribute-status-changed", { attrId: "5", to: "failed" }),
    ],
    [
      "an attribute failing as its acceptance is superseded",
      entry("attribute-status-changed", {
        attrId: "197",
        to: "failed",
        superseded: true,
      }),
    ],
    [
      "SMART failing because an acceptance was superseded",
      entry("smart-status-changed", {
        from: "warning",
        to: "failed",
        superseded: ["197"],
      }),
    ],
    [
      "SMART recovering because a fault was accepted",
      entry("smart-status-changed", {
        from: "failed",
        to: "warning",
        cause: "acceptance",
      }),
    ],
    [
      "SMART failing because an acceptance was cleared",
      entry("smart-status-changed", {
        from: "passed",
        to: "failed",
        cause: "acceptance",
      }),
    ],
    [
      "a pool fault raised to error",
      poolEntry("fault-severity-raised", {
        kind: "pool-status",
        key: "5:ZFS-8000-EY",
        severity: "error",
      }),
    ],
    [
      "a SMART warning",
      entry("smart-status-changed", { from: "passed", to: "warning" }),
    ],
    ["a spare in use", entry("state-changed", { from: "spare", to: "in-use" })],
    [
      "a missing disk retired",
      entry("state-changed", { from: "missing", to: "retired" }),
    ],
    [
      "a clean scrub",
      poolEntry("scrub-finished", { function: "SCRUB", errors: 0 }),
    ],
    [
      "a fault opening that has its own alert",
      poolEntry("fault-opened", {
        faultId: 4,
        kind: "pool-degraded",
        key: "5",
      }),
    ],
    [
      "a leaf failing while the pool degrades (pool-state-changed alerts)",
      vdevEntry({
        poolId: 5,
        poolState: "DEGRADED",
        from: "ONLINE",
        to: "FAULTED",
      }),
    ],
    [
      "a spare going into use",
      vdevEntry({
        poolId: 5,
        poolState: "ONLINE",
        from: "AVAIL",
        to: "ONLINE",
      }),
    ],
    [
      "a spare coming back available",
      vdevEntry({
        poolId: 5,
        poolState: "ONLINE",
        from: "ONLINE",
        to: "AVAIL",
      }),
    ],
    [
      "a vdev entry from before pool state was recorded",
      vdevEntry({ poolId: 5, from: "ONLINE", to: "UNAVAIL" }),
    ],
    ["a collector going out of date", hostEntry("current", "outdated")],
    ["a collector upgraded to current", hostEntry("outdated", "current")],
    ["an unrelated event", entry("disk-appeared", {})],
    ["a manual entry", { ...failedPending, kind: "manual" as const }],
    ["a subjectless entry", { ...failedPending, subjectId: null }],
  ])("ignores %s", (_, diaryEntry) => {
    expect(deriveAlert(diaryEntry, context)).toBeNull();
  });

  it("describes a disk with its host and the attribute", () => {
    expect(deriveAlert(failedPending, context)).toEqual({
      rule: "attribute-failed",
      severity: "alert",
      subjectType: "disk",
      subjectId: 3,
      host: "mars",
      subject: "mars · K2",
      title: "Attribute failed",
      message: "mars · K2: Current Pending Sector Count failed (16)",
      at,
      dedupeKey: "attribute-failed:disk:3:197:7",
      diaryEntryId: 7,
    });
  });

  it("falls back to model and serial for an unaliased disk", () => {
    const unaliased: AlertContext = {
      ...context,
      disk: () => ({
        alias: null,
        model: "WDC WD80",
        serial: "ABC",
        hostName: null,
        disposal: null,
      }),
    };
    expect(deriveAlert(failedPending, unaliased)?.subject).toBe("WDC WD80 ABC");
  });

  it("describes an incompatible collector with its host", () => {
    expect(
      deriveAlert(hostEntry("current", "incompatible"), context),
    ).toMatchObject({
      severity: "alert",
      host: "mars",
      subject: "mars · collector",
      title: "Collector incompatible",
      message:
        "mars · collector: 0.2.0 is too old; tetanus needs 0.3.0 or later",
    });
  });

  it("describes a pool with its host", () => {
    const alert = deriveAlert(
      poolEntry("scrub-finished", { function: "SCRUB", errors: 1 }),
      context,
    );
    expect(alert).toMatchObject({
      severity: "alert",
      subject: "mars · tank",
      message: "mars · tank: scrub finished with 1 error",
    });
  });

  it("raises pool-degraded on the pool when a cache leaf fails on an ONLINE pool", () => {
    expect(
      deriveAlert(
        vdevEntry({
          poolId: 5,
          poolState: "ONLINE",
          from: "ONLINE",
          to: "UNAVAIL",
        }),
        context,
      ),
    ).toMatchObject({
      rule: "pool-degraded",
      severity: "alert",
      subjectType: "pool",
      subjectId: 5,
      subject: "mars · tank",
      message: "mars · tank: C1 UNAVAIL (was ONLINE)",
      dedupeKey: "pool-degraded:pool:5:11:UNAVAIL:7",
    });
  });

  it("alerts when a disposed disk is seen again", () => {
    expect(
      deriveAlert(
        entry(
          "disposed-disk-seen",
          { hostId: 1, disposalOn: "2026-10-02" },
          { subjectId: 4 },
        ),
        context,
      ),
    ).toMatchObject({
      rule: "disposed-disk-seen",
      severity: "alert",
      subject: "mars · K4",
      message: "mars · K4: seen on mars, disposed (rma) 2026-10-02",
      dedupeKey: "disposed-disk-seen:disk:4:2026-10-02:7",
    });
  });

  it("skips other alerts for a disposed disk", () => {
    const disposed = { subjectId: 4 };
    expect(
      deriveAlert(
        entry("attribute-status-changed", failedPending.data, disposed),
        context,
      ),
    ).toBeNull();
    expect(
      deriveAlert(
        entry(
          "smart-status-changed",
          { from: "passed", to: "failed" },
          disposed,
        ),
        context,
      ),
    ).toBeNull();
  });

  it("skips entries for an archived pool, its vdevs included", () => {
    const archived = { subjectType: "pool", subjectId: 6 } as const;
    expect(
      deriveAlert(
        entry(
          "pool-state-changed",
          { from: "ONLINE", to: "DEGRADED" },
          archived,
        ),
        context,
      ),
    ).toBeNull();
    expect(
      deriveAlert(
        vdevEntry({
          poolId: 6,
          poolState: "ONLINE",
          from: "ONLINE",
          to: "UNAVAIL",
        }),
        context,
      ),
    ).toBeNull();
  });

  it("alerts on a late, stalled or target-gone replication, but not an archived one", () => {
    const replicationEntry = (subjectId: number, kind: string) =>
      entry(
        "fault-opened",
        { faultId: 9, kind, key: String(subjectId) },
        {
          subjectType: "replication",
          subjectId,
          title: `fault: Replication into vpool/tank/a ${kind}`,
        },
      );
    expect(
      deriveAlert(replicationEntry(5, "replication-stalled"), context),
    ).toMatchObject({
      rule: "replication-stalled",
      severity: "alert",
      host: "vault",
      subject: "vault · tank/a → vpool/tank/a",
      message:
        "vault · tank/a → vpool/tank/a: Replication into vpool/tank/a replication-stalled",
      dedupeKey: "replication-stalled:replication:5:5:7",
    });
    expect(
      deriveAlert(replicationEntry(5, "replication-late"), context)?.severity,
    ).toBe("notice");
    expect(
      deriveAlert(replicationEntry(5, "replication-target-gone"), context),
    ).toMatchObject({ rule: "replication-target-gone", severity: "alert" });
    expect(
      deriveAlert(replicationEntry(6, "replication-target-gone"), context),
    ).toBeNull();
    expect(
      deriveAlert(replicationEntry(6, "replication-stalled"), context),
    ).toBeNull();
    expect(
      deriveAlert(replicationEntry(5, "scrub-overdue"), context),
    ).toBeNull();
  });

  it("sends slow I/Os as a notice", () => {
    expect(
      deriveAlert(
        poolEntry("fault-opened", {
          faultId: 3,
          kind: "leaf-slow",
          key: "5:77",
        }),
        context,
      )?.severity,
    ).toBe("notice");
  });

  it("marks recoveries", () => {
    expect(
      deriveAlert(
        poolEntry("pool-state-changed", { from: "DEGRADED", to: "ONLINE" }),
        context,
      ),
    ).toMatchObject({
      severity: "recovery",
      message: "mars · tank: ONLINE (was DEGRADED)",
    });
  });
});

describe("deriveAlerts", () => {
  it("keeps entry order and drops non-alerts", () => {
    const alerts = deriveAlerts(
      [
        entry("disk-appeared", {}, { id: 1 }),
        { ...failedPending, id: 2 },
        entry("state-changed", { from: "in-use", to: "missing" }, { id: 3 }),
      ],
      context,
    );
    expect(alerts.map((alert) => [alert.diaryEntryId, alert.rule])).toEqual([
      [2, "attribute-failed"],
      [3, "disk-missing"],
    ]);
  });
});

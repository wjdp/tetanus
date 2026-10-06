import { describe, expect, it } from "vitest";
import { ALERT_RULES, type AlertRule } from "#shared/alerts";
import {
  allowedActions,
  FAULT_KINDS,
  type FaultKind,
  faultHint,
  faultTitle,
  thresholdSeverity,
} from "#shared/faults";

type AlertingRule = {
  [Rule in AlertRule]: (typeof ALERT_RULES)[Rule]["severity"] extends
    | "alert"
    | "notice"
    ? Rule
    : never;
}[AlertRule];

// Alerts are still driven by diary entries (036 §Alerts). This map keeps the
// two vocabularies in step: a new alert rule or fault kind fails here until
// it is placed. `disk-failed` also fires on attribute failure, so it is not
// one kind; `disposed-disk-seen` opens no fault (040).
const FAULT_KIND_OF_ALERT_RULE: Record<AlertingRule, FaultKind | null> = {
  "attribute-failed": "smart-attribute",
  "acceptance-superseded": "smart-attribute",
  "acknowledgement-superseded": "smart-attribute",
  "disk-failed": null,
  "disk-missing": "disk-missing",
  "pool-degraded": "pool-degraded",
  "pool-missing": "pool-missing",
  "pool-data-errors": "pool-data-errors",
  "leaf-errors": "leaf-errors",
  "leaf-slow": "leaf-slow",
  "scrub-overdue": "scrub-overdue",
  "pool-status": "pool-status",
  "scrub-paused": "scrub-paused",
  "scan-stalled": "scan-stalled",
  "vdev-unredundant": "vdev-unredundant",
  "pool-capacity": "pool-capacity",
  "replication-late": "replication-late",
  "replication-stalled": "replication-stalled",
  "replication-target-gone": "replication-target-gone",
  "identity-conflict": "identity-conflict",
  "disposed-disk-seen": null,
  "temperature-high": "temperature-high",
  "smart-counters-reset": "smart-counters-reset",
  "self-test-failed": "self-test-failed",
  "helium-tripped": "helium-tripped",
  "smart-unavailable": "smart-unavailable",
  "error-log-growth": "error-log-growth",
  "interface-errors": "interface-errors",
  "collector-incompatible": "collector-incompatible",
};

const FAULT_KINDS_WITHOUT_ALERT_RULE: FaultKind[] = [
  "smart-health-failed",
  "collector-silent",
  "collector-outdated",
  "host-degraded",
];

const now = Date.parse("2026-09-10T10:00:00Z");

describe("alert rules and fault kinds", () => {
  it("maps every alerting rule", () => {
    const alerting = Object.entries(ALERT_RULES)
      .filter(([, rule]) => rule.severity !== "recovery")
      .map(([name]) => name);
    expect(Object.keys(FAULT_KIND_OF_ALERT_RULE).sort()).toEqual(
      alerting.sort(),
    );
  });

  it("places every fault kind", () => {
    const placed = new Set([
      ...Object.values(FAULT_KIND_OF_ALERT_RULE),
      ...FAULT_KINDS_WITHOUT_ALERT_RULE,
    ]);
    expect(FAULT_KINDS.filter((kind) => !placed.has(kind))).toEqual([]);
  });
});

describe("faultTitle", () => {
  it.each([
    [
      "smart-attribute",
      { name: "Reallocated Sectors Count", value: 24, trend: "worsening" },
      "Reallocated Sectors Count 24, worsening",
    ],
    [
      "smart-attribute",
      {
        name: "Current Pending Sector Count",
        value: 2,
        acceptanceKind: "acknowledge",
        acceptedValue: 2,
      },
      "Current Pending Sector Count 2 · ack at 2",
    ],
    [
      "smart-attribute",
      { name: "Reallocated Sectors Count", value: 24, errorLogRise: 3 },
      "Reallocated Sectors Count 24, error log +3",
    ],
    [
      "smart-attribute",
      { name: "Reallocated Sectors Count", value: 24, errorLogRise: 0 },
      "Reallocated Sectors Count 24",
    ],
    [
      "smart-attribute",
      { name: "Reallocated Sectors Count", value: 8, source: "farm" },
      "Reallocated Sectors Count (FARM) 8",
    ],
    [
      "pool-degraded",
      { poolName: "vault", state: "DEGRADED" },
      "Pool vault DEGRADED",
    ],
    [
      "pool-degraded",
      {
        poolName: "tank",
        state: "DEGRADED",
        leaves: [
          { name: "/dev/disk/by-vdev/K3", role: "normal", state: "FAULTED" },
        ],
      },
      "Pool tank DEGRADED: K3 FAULTED",
    ],
    [
      "pool-degraded",
      {
        poolName: "zeta",
        state: "ONLINE",
        leaves: [{ name: "C1", role: "cache", state: "UNAVAIL" }],
      },
      "Pool zeta: cache C1 UNAVAIL",
    ],
    [
      "pool-degraded",
      {
        poolName: "tank",
        state: "DEGRADED",
        leaves: [
          { name: "K3", role: "normal", state: "REMOVED", diskMissing: true },
        ],
      },
      "Pool tank DEGRADED: K3 REMOVED (disk missing)",
    ],
    [
      "pool-missing",
      { poolName: "tank", lastSeenAt: "2026-09-07T10:00:00Z" },
      "Pool tank missing, last seen 3 d ago",
    ],
    [
      "leaf-errors",
      {
        poolName: "tank",
        name: "A7",
        read: 0,
        write: 0,
        checksum: 12,
        rise24h: 4,
      },
      "A7 in tank: R 0 W 0 C 12, +4 in 24 h",
    ],
    [
      "leaf-slow",
      { poolName: "tank", name: "A7", rise24h: 14 },
      "A7 in tank: 14 slow I/Os in 24 h",
    ],
    [
      "pool-data-errors",
      { poolName: "vault", function: "SCRUB", scanErrors: 1, dataErrors: 0 },
      "Pool vault: scrub found 1 error",
    ],
    [
      "pool-data-errors",
      { poolName: "vault", scanErrors: 0, dataErrors: 3 },
      "Pool vault: 3 data errors",
    ],
    [
      "scrub-overdue",
      { poolName: "tank", lastScrubAt: "2026-07-20T10:00:00Z" },
      "Pool tank last scrubbed 52 d ago",
    ],
    [
      "scrub-overdue",
      { poolName: "tank", lastScrubAt: null },
      "Pool tank never scrubbed",
    ],
    [
      "replication-late",
      { targetName: "vpool/tank/a", lastSyncAt: "2026-09-10T05:00:00Z" },
      "Replication into vpool/tank/a late, last synced 5 h ago",
    ],
    [
      "replication-stalled",
      { targetName: "vpool/tank/a", lastSyncAt: "2026-09-07T10:00:00Z" },
      "Replication into vpool/tank/a stalled, last synced 3 d ago",
    ],
    [
      "replication-target-gone",
      { targetName: "vpool/tank/a", lastSyncAt: "2026-09-07T10:00:00Z" },
      "Replication target vpool/tank/a no longer exists",
    ],
    [
      "pool-status",
      {
        poolName: "tank",
        msgid: "ZFS-8000-EY",
        title: "ZFS label hostid mismatch",
      },
      "Pool tank: ZFS-8000-EY ZFS label hostid mismatch",
    ],
    [
      "pool-status",
      {
        poolName: "tank",
        msgid: "ZFS-8000-ZZ",
        title: null,
        status: "Something new happened.\n\tMore detail.\n",
      },
      "Pool tank: ZFS-8000-ZZ Something new happened.",
    ],
    [
      "scrub-paused",
      { poolName: "tank", pausedAt: "2026-09-08T10:00:00Z" },
      "Pool tank scrub paused for 2 d",
    ],
    [
      "scan-stalled",
      {
        poolName: "vault",
        function: "RESILVER",
        progressAt: "2026-09-10T03:00:00Z",
      },
      "Pool vault resilver stalled for 7 h",
    ],
    [
      "vdev-unredundant",
      { poolName: "tank", name: "/dev/disk/by-vdev/S1-part1", role: "special" },
      "special S1-part1 in tank is a single device",
    ],
    [
      "collector-silent",
      { lastOkAt: "2026-09-01T10:00:00Z" },
      "No data for 9 d",
    ],
    [
      "collector-outdated",
      { version: "0.3.0", currentVersion: "0.3.1" },
      "Collector 0.3.0 is behind 0.3.1",
    ],
    [
      "host-degraded",
      { tool: "openzfs", version: "2.2.2", minVersion: "2.3" },
      "OpenZFS 2.2.2 is older than 2.3: no pool, dataset or snapshot data",
    ],
    [
      "host-degraded",
      { tool: "smartmontools", version: "6.6", minVersion: "7.0" },
      "smartmontools 6.6 is older than 7.0: no SMART data",
    ],
    [
      "disk-missing",
      { lastSeenAt: "2026-09-09T10:00:00Z" },
      "Missing, last seen 1 d ago",
    ],
    [
      "identity-conflict",
      { diskIds: [3, 7], others: "K7" },
      "Identity conflict with K7",
    ],
    [
      "identity-conflict",
      { diskIds: [3, 7] },
      "Identity conflict with another disk",
    ],
    [
      "temperature-high",
      { celsius: 58, threshold: 55, hotSince: "2026-09-10T08:00:00Z" },
      "58 °C (limit 55 °C), hot for 2 h",
    ],
    ["temperature-high", {}, "Running hot"],
    [
      "pool-capacity",
      { poolName: "tank", cap: 91, frag: 34 },
      "Pool tank 91 % full · frag 34 %",
    ],
    [
      "pool-capacity",
      {
        poolName: "tank",
        cap: 85,
        frag: null,
        vdevGuid: "2",
        name: "mirror-1",
        role: "special",
      },
      "special mirror-1 in tank 85 % full",
    ],
    ["pool-capacity", { vdevGuid: "2" }, "Pool nearly full"],
    [
      "self-test-failed",
      {
        type: "Extended offline",
        status: "Completed: read failure",
        lifetimeHours: 1200,
        lba: 1234,
      },
      "Long self-test failed: read failure at LBA 1234",
    ],
    [
      "self-test-failed",
      {
        type: "Short offline",
        status: "Completed: electrical failure",
        lifetimeHours: 1200,
        lba: null,
      },
      "Short self-test failed: electrical failure",
    ],
    ["helium-tripped", {}, "Helium pressure threshold tripped"],
    ["smart-unavailable", { reason: "unsupported" }, "SMART is not supported"],
    ["smart-unavailable", { reason: "disabled" }, "SMART is disabled"],
    [
      "smart-unavailable",
      { reason: "unreadable" },
      "SMART data could not be read",
    ],
    [
      "error-log-growth",
      { count: 7, rise: 2, previousCount: 5, firstRiseAt: null },
      "Error log grew by 2 (7 total)",
    ],
    [
      "interface-errors",
      { count: 40, rise: 12, readings: 3 },
      "Interface CRC errors rising: +12 in 7 days (cabling, not the drive)",
    ],
  ] as const)("renders %s", (kind, data, title) => {
    expect(faultTitle({ kind, data }, now)).toBe(title);
  });
});

describe("faultHint", () => {
  it.each([
    ["unreadable", "Often a USB bridge that needs a smartctl device type."],
    ["disabled", "Turn it on with smartctl -s on <device>."],
    ["unsupported", null],
  ])("gives %s SMART the hint %s", (reason, hint) => {
    expect(faultHint({ kind: "smart-unavailable", data: { reason } })).toBe(
      hint,
    );
  });

  it("is null for a kind without a hint", () => {
    expect(faultHint({ kind: "helium-tripped", data: {} })).toBeNull();
  });
});

describe("thresholdSeverity", () => {
  const levels = { warning: 45, error: 55 };

  it.each([
    [null, 44, null],
    [null, 45, "warning"],
    [null, 55, "error"],
    ["warning", 43, "warning"],
    ["warning", 42, "warning"],
    ["warning", 41, null],
    ["error", 53, "error"],
    ["error", 52, "error"],
    ["error", 51, "warning"],
    ["error", 41, null],
  ] as const)("from %s at %i is %s", (current, value, expected) => {
    expect(thresholdSeverity(current, value, levels, 3)).toBe(expected);
  });
});

describe("allowedActions", () => {
  it("offers nothing on a resolved fault", () => {
    expect(
      allowedActions({ kind: "smart-attribute", state: "resolved" }),
    ).toEqual([]);
  });

  it("follows the kind table and the state", () => {
    expect(allowedActions({ kind: "smart-attribute", state: "open" })).toEqual([
      "acknowledge",
      "accept",
    ]);
    expect(
      allowedActions({ kind: "smart-attribute", state: "acknowledged" }),
    ).toEqual(["accept", "clear"]);
    expect(
      allowedActions({ kind: "smart-attribute", state: "accepted" }),
    ).toEqual(["clear"]);
    expect(
      allowedActions({ kind: "collector-incompatible", state: "open" }),
    ).toEqual(["acknowledge"]);
    expect(
      allowedActions({ kind: "identity-conflict", state: "open" }),
    ).toEqual(["acknowledge"]);
    expect(
      allowedActions({ kind: "leaf-errors", state: "acknowledged" }),
    ).toEqual(["accept", "clear", "resolve"]);
  });
});

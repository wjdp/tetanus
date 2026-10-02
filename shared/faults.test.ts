import { describe, expect, it } from "vitest";
import { ALERT_RULES, type AlertRule } from "#shared/alerts";
import {
  allowedActions,
  FAULT_KINDS,
  type FaultKind,
  faultTitle,
} from "#shared/faults";

type AlertingRule = {
  [Rule in AlertRule]: (typeof ALERT_RULES)[Rule]["severity"] extends "alert"
    ? Rule
    : never;
}[AlertRule];

// Alerts are still driven by diary entries (036 §Alerts). This map keeps the
// two vocabularies in step: a new alert rule or fault kind fails here until
// it is placed. `disk-failed` also fires on attribute failure, so it is not
// one kind.
const FAULT_KIND_OF_ALERT_RULE: Record<AlertingRule, FaultKind | null> = {
  "attribute-failed": "smart-attribute",
  "acceptance-superseded": "smart-attribute",
  "acknowledgement-superseded": "smart-attribute",
  "disk-failed": null,
  "disk-missing": "disk-missing",
  "pool-degraded": "pool-degraded",
  "scan-errors": "scan-errors",
  "identity-conflict": "identity-conflict",
  "collector-incompatible": "collector-incompatible",
};

const FAULT_KINDS_WITHOUT_ALERT_RULE: FaultKind[] = [
  "smart-health-failed",
  "collector-silent",
  "collector-outdated",
];

const now = Date.parse("2026-09-10T10:00:00Z");

describe("alert rules and fault kinds", () => {
  it("maps every alerting rule", () => {
    const alerting = Object.entries(ALERT_RULES)
      .filter(([, rule]) => rule.severity === "alert")
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
      "pool-degraded",
      { poolName: "vault", state: "DEGRADED" },
      "Pool vault DEGRADED",
    ],
    [
      "scan-errors",
      { poolName: "vault", function: "SCRUB", errors: 1 },
      "Pool vault scrub found 1 error",
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
      "disk-missing",
      { lastSeenAt: "2026-09-09T10:00:00Z" },
      "Missing, last seen 1 d ago",
    ],
    ["identity-conflict", { diskIds: [3, 7] }, "Identity conflict with disk 7"],
  ] as const)("renders %s", (kind, data, title) => {
    expect(faultTitle({ kind, data }, now)).toBe(title);
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
  });
});

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

const hostEntry = (from: string, to: string, version = "0.2.0") =>
  entry(
    "collector-status-changed",
    { from, to, version, minVersion: "0.3.0" },
    { subjectType: "host", subjectId: 1 },
  );

const context: AlertContext = {
  disk: (id) =>
    id === 3
      ? { alias: "K2", model: "WDC WD80", serial: "ABC", hostName: "mars" }
      : undefined,
  pool: (id) => (id === 5 ? { name: "tank", hostName: "mars" } : undefined),
  host: (id) => (id === 1 ? { name: "mars" } : undefined),
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
      "scan-errors",
      "3",
    ],
    [
      "resilver errors",
      poolEntry("resilver-finished", { function: "RESILVER", errors: 1 }),
      "scan-errors",
      "1",
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

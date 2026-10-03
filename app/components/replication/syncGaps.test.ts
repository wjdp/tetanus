import { describe, expect, it } from "vitest";
import { DEFAULT_REPLICATION_THRESHOLDS } from "#shared/replications";
import { syncLogRows } from "./syncGaps";

const HOUR = 3600;

const sync = (id: number, at: string) => ({
  id,
  at,
  snapshotName: `autosnap_${id}`,
  guid: null,
  snapshots: 1,
});

const syncs = [
  sync(5, "2026-09-28T12:00:00.000Z"),
  sync(4, "2026-09-28T11:00:00.000Z"),
  sync(3, "2026-09-28T06:00:00.000Z"),
  sync(2, "2026-09-26T00:00:00.000Z"),
  sync(1, "2026-09-25T23:00:00.000Z"),
];

describe("syncLogRows", () => {
  it("gives each sync its gap and marks the ones a status would have flagged", () => {
    const rows = syncLogRows(syncs, HOUR, DEFAULT_REPLICATION_THRESHOLDS);

    expect(rows.map((row) => row.gapMs && row.gapMs / 3_600_000)).toEqual([
      1,
      5,
      54,
      1,
      null,
    ]);
    expect(rows.map((row) => row.gapSeverity)).toEqual([
      null,
      "late",
      "stalled",
      null,
      null,
    ]);
  });

  it("marks nothing while the interval is unknown", () => {
    const rows = syncLogRows(syncs, null, DEFAULT_REPLICATION_THRESHOLDS);
    expect(rows.every((row) => row.gapSeverity === null)).toBe(true);
  });
});

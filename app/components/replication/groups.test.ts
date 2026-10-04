import { describe, expect, it } from "vitest";
import { groupReplications, statusSummary, targetParts } from "./groups";
import { endpoint, replicationRow } from "./testFixtures";

describe("groupReplications", () => {
  const rows = [
    replicationRow(1, { status: "ok" }),
    replicationRow(2, {
      source: endpoint("atlas", "tank/backups"),
      target: endpoint("styx", "vault/replica/tank/backups", { hostId: 2 }),
      status: "late",
    }),
    replicationRow(3, {
      source: null,
      target: endpoint("styx", "vault/old/root", { hostId: 2 }),
      status: "learning",
    }),
    replicationRow(4, {
      source: endpoint("atlas", "tank/media/photos"),
      target: endpoint("styx", "vault/replica/tank/media/photos"),
    }),
  ];

  it("groups by source host and target host, worst status first", () => {
    const groups = groupReplications(rows);

    expect(groups.map((group) => group.rows.map((row) => row.id))).toEqual([
      [2, 1, 4],
      [3],
    ]);
    expect(groups[0]).toMatchObject({
      sourceHost: "atlas",
      targetHost: "styx",
      status: "late",
    });
    expect(groups[1]).toMatchObject({ sourceHost: null, status: "learning" });
  });

  it("is empty without rows", () => {
    expect(groupReplications([])).toEqual([]);
  });
});

describe("targetParts", () => {
  it("dims the prefix a target adds in front of the source path", () => {
    expect(
      targetParts({
        source: endpoint("atlas", "tank/a"),
        target: endpoint("styx", "vault/replica/tank/a"),
      }),
    ).toEqual({ prefix: "vault/replica/", mirrored: "tank/a" });
  });

  it("leaves a target that does not mirror its source whole", () => {
    expect(
      targetParts({
        source: endpoint("atlas", "tank/a"),
        target: endpoint("styx", "vault/b"),
      }),
    ).toEqual({ prefix: "", mirrored: "vault/b" });
    expect(
      targetParts({ source: null, target: endpoint("styx", "vault/b") }),
    ).toEqual({ prefix: "", mirrored: "vault/b" });
  });
});

describe("statusSummary", () => {
  it("counts the statuses worth a look, worst first", () => {
    expect(
      statusSummary([
        replicationRow(1, { status: "late" }),
        replicationRow(2, { status: "ok" }),
        replicationRow(3, { status: "stalled" }),
        replicationRow(4, { status: "late" }),
        replicationRow(5, { status: "archived" }),
        replicationRow(6, { status: "source-gone" }),
        replicationRow(7, { status: "target-gone" }),
      ]),
    ).toBe("1 target gone · 1 stalled · 2 late · 1 source gone");
    expect(statusSummary([replicationRow(1)])).toBe("");
  });
});

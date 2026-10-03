import { describe, expect, it } from "vitest";
import { groupReplications, parentPattern } from "./groups";
import { endpoint, replicationRow } from "./testFixtures";

describe("parentPattern", () => {
  it("replaces the last segment with a wildcard", () => {
    expect(parentPattern("tank/media/photos")).toBe("tank/media/*");
    expect(parentPattern("tank")).toBe("tank");
  });
});

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

  it("groups by source and target host and parent, worst status first", () => {
    const groups = groupReplications(rows);

    expect(groups.map((group) => group.rows.map((row) => row.id))).toEqual([
      [1, 2],
      [3],
      [4],
    ]);
    expect(groups[0]).toMatchObject({
      source: { host: "atlas", parent: "tank/*" },
      target: { host: "styx", parent: "vault/replica/tank/*" },
      status: "late",
    });
    expect(groups[1]).toMatchObject({ source: null, status: "learning" });
  });

  it("is empty without rows", () => {
    expect(groupReplications([])).toEqual([]);
  });
});

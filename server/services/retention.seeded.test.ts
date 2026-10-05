import { beforeAll, describe, expect, it } from "vitest";
import { sqlite } from "~~/server/database/client";
import { listHosts } from "~~/server/services/hosts";
import { latestReading } from "~~/server/services/smart";
import { listPools } from "~~/server/services/zfs";
import { loadSeededDatabase, SEEDED_AT } from "~~/test/seeded";
import { type PruneCounts, pruneDatabase } from "./retention";

const diskIds = () =>
  sqlite.prepare("SELECT id FROM Disk ORDER BY id").pluck().all() as number[];

const count = (table: string) =>
  sqlite.prepare(`SELECT count(*) FROM ${table}`).pluck().get() as number;

function snapshot() {
  return {
    hosts: listHosts(),
    latestReadings: diskIds().map((id) => latestReading(id)?.id ?? null),
    pools: listPools(SEEDED_AT),
    faults: count("Fault"),
    diary: count("DiaryEntry"),
  };
}

describe("pruneDatabase over the demo fleet", () => {
  let before: ReturnType<typeof snapshot>;
  let first: PruneCounts;

  beforeAll(async () => {
    await loadSeededDatabase();
    before = snapshot();
    first = await pruneDatabase(SEEDED_AT);
  });

  it("downsamples the long histories", () => {
    expect(first.smartReadings).toBeGreaterThan(0);
    expect(first.temperatureReadings).toBeGreaterThan(0);
  });

  it("leaves what the pages read unchanged", () => {
    expect(snapshot()).toEqual(before);
  });

  it("deletes nothing on a second run", async () => {
    const second = await pruneDatabase(SEEDED_AT);
    expect(Object.values(second).every((deleted) => deleted === 0)).toBe(true);
  });
});

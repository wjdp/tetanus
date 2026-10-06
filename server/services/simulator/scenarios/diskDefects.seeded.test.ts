import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { listDisks } from "~~/server/services/disks";
import { listFaults } from "~~/server/services/faults";
import { dumpDatabase } from "~~/test/db";
import { loadSeededDatabase, SEEDED_AT } from "~~/test/seeded";
import { restore, simulate, subjectScenarios } from "../run";

const NOW = SEEDED_AT;
const LATER = new Date(NOW.getTime() + 10 * 60 * 1000);

const uncorrectableFaults = (diskId: number) =>
  listFaults({ state: ["open", "acknowledged"] }).faults.filter(
    (fault) =>
      fault.subject.id === diskId &&
      fault.kind === "smart-attribute" &&
      fault.data.attrId === "187",
  );

async function diskOffering(scenarioId: string) {
  for (const row of await listDisks(NOW)) {
    const { scenarios } = subjectScenarios("disk", row.id);
    if (scenarios.some((scenario) => scenario.id === scenarioId)) return row;
  }
  throw new Error(`No disk offers ${scenarioId}`);
}

let before: ReturnType<typeof dumpDatabase>;

beforeAll(async () => {
  await loadSeededDatabase();
});

beforeEach(() => {
  before = dumpDatabase();
  return () => {
    restore();
    expect(dumpDatabase()).toEqual(before);
  };
});

describe("statistics-uncorrectable scenario", () => {
  it("raises a substitute attribute 187 fault and fails the disk", async () => {
    const target = await diskOffering("statistics-uncorrectable");
    expect(uncorrectableFaults(target.id)).toEqual([]);

    await simulate("disk", target.id, "statistics-uncorrectable", {}, LATER);

    expect(uncorrectableFaults(target.id)).toMatchObject([
      { severity: "error", data: { source: "device-statistics" } },
    ]);
    const after = (await listDisks(LATER)).find((row) => row.id === target.id);
    expect(after?.latestStatus).toBe("failed");
  }, 60_000);
});

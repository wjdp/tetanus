import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { listDisks } from "~~/server/services/disks";
import { listFaults } from "~~/server/services/faults";
import { dumpDatabase } from "~~/test/db";
import { loadSeededDatabase, SEEDED_AT } from "~~/test/seeded";
import { restore, simulate, subjectScenarios } from "../run";

const NOW = SEEDED_AT;
const minutesLater = (minutes: number) =>
  new Date(NOW.getTime() + minutes * 60 * 1000);

const diskFaults = (diskId: number) =>
  listFaults({ state: ["open", "acknowledged", "accepted"] }).faults.filter(
    (fault) => fault.subject.id === diskId,
  );

const errorLogFaults = (diskId: number) =>
  listFaults({ state: ["open", "acknowledged"] }).faults.filter(
    (fault) => fault.subject.id === diskId && fault.kind === "error-log-growth",
  );

async function diskOffering(scenarioId: string) {
  for (const row of await listDisks(NOW)) {
    if (diskFaults(row.id).length > 0) continue;
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

describe("error log scenarios", () => {
  it("raises an error log growth fault on a rise", async () => {
    const target = await diskOffering("error-log-growth");

    await simulate(
      "disk",
      target.id,
      "error-log-growth",
      { errors: 4 },
      minutesLater(10),
    );

    expect(errorLogFaults(target.id)).toMatchObject([{ data: { rise: 4 } }]);
  });
});

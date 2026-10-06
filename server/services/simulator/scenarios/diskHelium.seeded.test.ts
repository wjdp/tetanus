import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { listDisks } from "~~/server/services/disks";
import { listFaults } from "~~/server/services/faults";
import { dumpDatabase } from "~~/test/db";
import { loadSeededDatabase, SEEDED_AT } from "~~/test/seeded";
import { restore, simulate, subjectScenarios } from "../run";

const NOW = SEEDED_AT;
const LATER = new Date(NOW.getTime() + 10 * 60 * 1000);

const heliumFaults = (diskId: number) =>
  listFaults({ state: ["open", "acknowledged"] }).faults.filter(
    (fault) => fault.subject.id === diskId && fault.kind === "helium-tripped",
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

describe("helium-tripped scenario", () => {
  it("raises helium-tripped as an error", async () => {
    const target = await diskOffering("helium-tripped");
    expect(heliumFaults(target.id)).toEqual([]);

    await simulate("disk", target.id, "helium-tripped", {}, LATER);

    expect(heliumFaults(target.id)).toMatchObject([{ severity: "error" }]);
  }, 60_000);
});

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { listDisks } from "~~/server/services/disks";
import { listFaults } from "~~/server/services/faults";
import { dumpDatabase } from "~~/test/db";
import { loadSeededDatabase, SEEDED_AT } from "~~/test/seeded";
import { restore, simulate, subjectScenarios } from "../run";

const NOW = SEEDED_AT;
const LATER = new Date(NOW.getTime() + 10 * 60 * 1000);

const smartUnavailableFaults = (diskId: number) =>
  listFaults({ state: ["open", "acknowledged"] }).faults.filter(
    (fault) =>
      fault.subject.id === diskId && fault.kind === "smart-unavailable",
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

describe("no usable SMART data scenarios", () => {
  it.each([
    ["smart-unsupported", "unsupported"],
    ["smart-disabled", "disabled"],
    ["smart-unreadable", "unreadable"],
  ])(
    "%s raises smart-unavailable with reason %s",
    async (scenarioId, reason) => {
      const target = await diskOffering(scenarioId);
      expect(smartUnavailableFaults(target.id)).toEqual([]);

      await simulate("disk", target.id, scenarioId, {}, LATER);

      expect(smartUnavailableFaults(target.id)).toMatchObject([
        { severity: "warning", data: { reason } },
      ]);
    },
    60_000,
  );
});

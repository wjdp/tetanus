import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FAULT_KIND_DEFINITIONS } from "#shared/faults";
import { listDisks } from "~~/server/services/disks";
import { listFaults } from "~~/server/services/faults";
import { dumpDatabase } from "~~/test/db";
import { loadSeededDatabase, SEEDED_AT } from "~~/test/seeded";
import { restore, simulate, subjectScenarios } from "../run";

const NOW = SEEDED_AT;
const minutesLater = (minutes: number) =>
  new Date(NOW.getTime() + minutes * 60 * 1000);

const interfaceTitle = FAULT_KIND_DEFINITIONS["interface-errors"].title;

const interfaceFaults = (diskId: number) =>
  listFaults({ state: ["open", "acknowledged"] }).faults.filter(
    (fault) => fault.subject.id === diskId && fault.kind === "interface-errors",
  );

async function diskOffering(scenarioId: string) {
  for (const row of await listDisks(NOW)) {
    if (interfaceFaults(row.id).length > 0) continue;
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

describe("interface scenarios", () => {
  it("raises an interface errors fault on the third rise", async () => {
    const target = await diskOffering("crc-errors-rising");

    await simulate(
      "disk",
      target.id,
      "crc-errors-rising",
      { readings: 2, step: 5 },
      minutesLater(10),
    );
    expect(interfaceFaults(target.id)).toEqual([]);

    await simulate(
      "disk",
      target.id,
      "crc-errors-rising",
      { readings: 1, step: 5 },
      minutesLater(20),
    );
    const [raised] = interfaceFaults(target.id);
    expect(raised?.severity).toBe("warning");
    expect(raised?.data).toMatchObject({ readings: 3 });
    expect(
      raised && interfaceTitle(raised.data, minutesLater(20).getTime()),
    ).toMatch(/^Interface CRC errors rising: \+\d+ in 7 days/);
  }, 60_000);
});

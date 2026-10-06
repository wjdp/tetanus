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

const titleOf = (data: Parameters<typeof selfTestTitle>[0] | undefined) =>
  data && selfTestTitle(data, NOW.getTime());
const selfTestTitle = FAULT_KIND_DEFINITIONS["self-test-failed"].title;

const selfTestFaults = (diskId: number) =>
  listFaults({ state: ["open", "acknowledged"] }).faults.filter(
    (fault) => fault.subject.id === diskId && fault.kind === "self-test-failed",
  );

async function diskWith(...scenarioIds: string[]) {
  for (const row of await listDisks(NOW)) {
    const { scenarios } = subjectScenarios("disk", row.id);
    const offered = new Set(scenarios.map((scenario) => scenario.id));
    if (scenarioIds.every((id) => offered.has(id))) return row;
  }
  throw new Error(`No disk offers ${scenarioIds.join(", ")}`);
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

describe("self-test scenarios", () => {
  it("raises a fault for a failed short test and clears it with a passing long test", async () => {
    const target = await diskWith("self-test-failed", "self-test-passed");
    expect(selfTestFaults(target.id)).toEqual([]);

    await simulate(
      "disk",
      target.id,
      "self-test-failed",
      { type: "short", lba: 4096 },
      minutesLater(10),
    );
    const [raised] = selfTestFaults(target.id);
    expect(raised?.data).toMatchObject({ lba: 4096 });
    expect(titleOf(raised?.data)).toMatch(
      /^Short self-test failed: .+ at LBA 4096$/,
    );

    await simulate("disk", target.id, "self-test-passed", {}, minutesLater(20));
    expect(selfTestFaults(target.id)).toEqual([]);
  }, 60_000);

  it("raises a fault for a failed long test", async () => {
    const target = await diskWith("self-test-failed");

    await simulate(
      "disk",
      target.id,
      "self-test-failed",
      { type: "extended", lba: 8192 },
      minutesLater(10),
    );

    expect(titleOf(selfTestFaults(target.id)[0]?.data)).toMatch(
      /^(Long|Extended) self-test failed: .+ at LBA 8192$/,
    );
  }, 60_000);
});

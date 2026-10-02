import { beforeAll, describe, expect, it } from "vitest";
import { FAULT_STATES } from "#shared/faults";
import { seed } from "~~/server/demo/seed";
import { DEMO_EPOCH, HOUR_MS } from "~~/server/demo/timeline";
import { listDisks } from "~~/server/services/disks";
import { listFaults } from "~~/server/services/faults";
import { latestAttributes } from "~~/server/services/smart";
import { dumpDatabase } from "~~/test/db";
import { restore, simulate, simulatorStatus, subjectScenarios } from "./run";

const NOW = new Date(DEMO_EPOCH.getTime() + 2 * HOUR_MS);
const LATER = new Date(NOW.getTime() + 10 * 60 * 1000);

const liveFaults = () => listFaults({ state: ["open", "acknowledged"] }).faults;
const allFaults = () => listFaults({ state: [...FAULT_STATES] }).faults;

async function diskWith(scenarioId: string) {
  for (const row of await listDisks(NOW)) {
    const { scenarios } = subjectScenarios("disk", row.id);
    if (scenarios.some((scenario) => scenario.id === scenarioId)) return row;
  }
  throw new Error(`No disk offers ${scenarioId}`);
}

beforeAll(async () => {
  await seed(NOW, { replay: "short" });
}, 120_000);

describe("simulate", () => {
  it("offers nothing for a disk out of service", async () => {
    const detached = (await listDisks(NOW)).find((row) => row.state === "sold");
    expect(detached).toBeDefined();
    expect(subjectScenarios("disk", detached?.id ?? 0).scenarios).toEqual([]);
  });

  it("opens faults through ingest and restores the database exactly", async () => {
    const before = dumpDatabase();
    const target = await diskWith("pending-sectors");

    await simulate("disk", target.id, "pending-sectors", { raw: 12 }, LATER);
    const pending = latestAttributes(target.id).find(
      (attribute) => attribute.attrId === "197",
    );
    expect(pending?.rawValue).toBe(12);
    expect(
      liveFaults().some(
        (fault) =>
          fault.kind === "smart-attribute" &&
          fault.subject.id === target.id &&
          fault.data.attrId === "197",
      ),
    ).toBe(true);

    await simulate("disk", target.id, "smart-health-failed", {}, LATER);
    await simulate("disk", target.id, "disk-missing", {}, LATER);
    const kinds = liveFaults()
      .filter((fault) => fault.subject.id === target.id)
      .map((fault) => fault.kind);
    expect(kinds).toEqual(
      expect.arrayContaining(["smart-health-failed", "disk-missing"]),
    );
    expect(simulatorStatus().simulations.map((row) => row.scenario)).toEqual([
      "pending-sectors",
      "smart-health-failed",
      "disk-missing",
    ]);

    const faultsBefore = allFaults().length;
    restore();
    expect(simulatorStatus().simulations).toEqual([]);
    expect(allFaults().length).toBeLessThan(faultsBefore);
    expect(dumpDatabase()).toEqual(before);
  }, 60_000);

  it("rejects out-of-range params and scenarios that do not apply", async () => {
    const target = await diskWith("pending-sectors");
    await expect(
      simulate("disk", target.id, "pending-sectors", { raw: -1 }, LATER),
    ).rejects.toThrow(/out of range/);
    await expect(
      simulate("disk", target.id, "no-such-scenario", {}, LATER),
    ).rejects.toThrow(/does not apply/);
    expect(simulatorStatus().simulations).toEqual([]);
  });
});

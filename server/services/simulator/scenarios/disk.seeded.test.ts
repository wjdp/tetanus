import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { temperatureColour } from "#shared/temperature";
import { listDisks } from "~~/server/services/disks";
import { listFaults } from "~~/server/services/faults";
import { getSmartOverview, latestAttributes } from "~~/server/services/smart";
import { dumpDatabase } from "~~/test/db";
import { loadSeededDatabase, SEEDED_AT } from "~~/test/seeded";
import { restore, simulate, subjectScenarios } from "../run";

const NOW = SEEDED_AT;
const LATER = new Date(NOW.getTime() + 10 * 60 * 1000);

const liveFaults = (diskId: number) =>
  listFaults({ state: ["open", "acknowledged"] }).faults.filter(
    (fault) => fault.subject.id === diskId,
  );

const attributeOf = (diskId: number, attrId: string) =>
  latestAttributes(diskId).find((attribute) => attribute.attrId === attrId);

async function diskWith(...scenarioIds: string[]) {
  for (const row of await listDisks(NOW)) {
    const { scenarios } = subjectScenarios("disk", row.id);
    const offered = new Set(scenarios.map((scenario) => scenario.id));
    if (scenarioIds.every((id) => offered.has(id))) return row;
  }
  throw new Error(`No disk offers ${scenarioIds.join(", ")}`);
}

async function summaryOf(diskId: number) {
  const row = (await listDisks(LATER)).find((each) => each.id === diskId);
  if (!row) throw new Error(`No disk ${diskId}`);
  return row;
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

describe("SMART attribute scenarios", () => {
  it("opens a fault for reallocated sectors and offers any attribute", async () => {
    const target = await diskWith("reallocated-sectors", "any-attribute");
    await simulate("disk", target.id, "reallocated-sectors", {}, LATER);
    expect(attributeOf(target.id, "5")).toMatchObject({
      rawValue: 24,
      status: "failed",
    });
    expect(
      liveFaults(target.id).some(
        (fault) =>
          fault.kind === "smart-attribute" && fault.data.attrId === "5",
      ),
    ).toBe(true);

    const any = subjectScenarios("disk", target.id).scenarios.find(
      (scenario) => scenario.id === "any-attribute",
    );
    const [attribute, raw] = any?.params ?? [];
    expect(attribute).toMatchObject({ kind: "select", default: "5" });
    expect(raw).toMatchObject({ kind: "number", default: 25 });
    await simulate(
      "disk",
      target.id,
      "any-attribute",
      { attribute: "198", raw: 3 },
      LATER,
    );
    expect(attributeOf(target.id, "198")?.status).toBe("failed");
  }, 60_000);
});

describe("Health scenarios", () => {
  it("raises NVMe warnings, media errors, wear and a failed self-test", async () => {
    const target = await diskWith("nvme-critical-warning", "self-test-failed");
    await simulate("disk", target.id, "nvme-critical-warning", {}, LATER);
    await simulate("disk", target.id, "nvme-media-errors", {}, LATER);
    await simulate(
      "disk",
      target.id,
      "ssd-wear-out",
      { percentageUsed: 101 },
      LATER,
    );
    await simulate(
      "disk",
      target.id,
      "self-test-failed",
      { type: "extended", lba: 4096 },
      LATER,
    );

    for (const attrId of [
      "critical_warning",
      "available_spare",
      "media_errors",
      "percentage_used",
    ]) {
      expect(attributeOf(target.id, attrId)?.status).toBe("failed");
    }
    expect(liveFaults(target.id).map((fault) => fault.kind)).toContain(
      "smart-health-failed",
    );
    const [latest] = getSmartOverview(target.id, "7d", LATER).selfTests;
    expect(latest).toMatchObject({
      type: "Extended",
      passed: false,
      lba: 4096,
    });
  }, 60_000);

  it("shrinks a disk and raises a capacity-changed fault", async () => {
    const target = await diskWith("capacity-shrunk");
    const before = target.capacityBytes as number;
    await simulate(
      "disk",
      target.id,
      "capacity-shrunk",
      { percent: 10 },
      LATER,
    );

    const after = (await listDisks(LATER)).find((row) => row.id === target.id);
    expect(after?.capacityBytes).toBeLessThan(before * 0.95);
    expect(liveFaults(target.id).map((fault) => fault.kind)).toContain(
      "capacity-changed",
    );
  }, 60_000);

  it("wears out a SATA SSD", async () => {
    const target = (await listDisks(NOW)).find(
      (row) =>
        attributeOf(row.id, "177") !== undefined &&
        subjectScenarios("disk", row.id).scenarios.some(
          (scenario) => scenario.id === "ssd-wear-out",
        ),
    );
    if (!target) throw new Error("No SATA SSD with Wear_Leveling_Count");
    await simulate("disk", target.id, "ssd-wear-out", {}, LATER);
    expect(attributeOf(target.id, "177")?.value).toBe(2);
  }, 60_000);
});

describe("Temperature scenarios", () => {
  it("runs hot, then critical, past the host's thresholds", async () => {
    const target = await diskWith("temperature-hot", "temperature-critical");
    await simulate("disk", target.id, "temperature-hot", {}, LATER);
    let summary = await summaryOf(target.id);
    expect(summary.latestTemp).toBe(summary.tempThresholds.warning + 2);
    expect(temperatureColour(summary.latestTemp, summary.tempThresholds)).toBe(
      "warning",
    );
    const hot = () =>
      liveFaults(target.id).find((fault) => fault.kind === "temperature-high");
    expect(hot()?.severity).toBe("warning");

    await simulate("disk", target.id, "temperature-critical", {}, LATER);
    summary = await summaryOf(target.id);
    expect(summary.latestTemp).toBe(summary.tempThresholds.error + 2);
    expect(temperatureColour(summary.latestTemp, summary.tempThresholds)).toBe(
      "error",
    );
    expect(hot()?.severity).toBe("error");
  }, 60_000);
});

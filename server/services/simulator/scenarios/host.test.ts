import { beforeAll, describe, expect, it } from "vitest";
import { MIN_COLLECTOR_VERSION } from "#shared/collector";
import { type FaultKind, faultTitle } from "#shared/faults";
import { allGroupFreshness, formatDuration } from "#shared/hostFreshness";
import { seed } from "~~/server/demo/seed";
import { DEMO_EPOCH, HOUR_MS } from "~~/server/demo/timeline";
import { listDiary } from "~~/server/services/diary";
import { listFaults } from "~~/server/services/faults";
import { listHosts } from "~~/server/services/hosts";
import { dumpDatabase } from "~~/test/db";
import { restore, simulate, subjectScenarios } from "../run";

const NOW = new Date(DEMO_EPOCH.getTime() + 2 * HOUR_MS);
const LATER = new Date(NOW.getTime() + 10 * 60 * 1000);

const hostNamed = (name: string) => {
  const found = listHosts().find((row) => row.name === name);
  if (!found) throw new Error(`No host ${name}`);
  return found;
};

const faultsOf = (kind: FaultKind, hostId: number) =>
  listFaults({ state: ["open", "acknowledged"] }).faults.filter(
    (fault) => fault.kind === kind && fault.subject.id === hostId,
  );

const missingDiskFaultIds = () =>
  listFaults({ state: ["open", "acknowledged"] })
    .faults.filter((fault) => fault.kind === "disk-missing")
    .map((fault) => fault.id);

const scenarioIds = (hostId: number) =>
  subjectScenarios("host", hostId).scenarios.map((scenario) => scenario.id);

beforeAll(async () => {
  await seed(NOW, { replay: "short" });
}, 120_000);

describe("host scenarios", () => {
  it("offers no silence on an intermittent host, which goes offline instead", () => {
    expect(scenarioIds(hostNamed("bench").id)).not.toContain(
      "collector-silent",
    );
  });

  it("silences a collector until every chip is stale, without missing its disks", async () => {
    const before = dumpDatabase();
    const atlas = hostNamed("atlas");
    const param = subjectScenarios("host", atlas.id).scenarios.find(
      (scenario) => scenario.id === "collector-silent",
    )?.params[0];
    if (param?.kind !== "number") throw new Error("Expected an hours param");
    const missingBefore = missingDiskFaultIds();

    await simulate("host", atlas.id, "collector-silent", {}, LATER);
    const [silent] = faultsOf("collector-silent", atlas.id);
    expect(silent && faultTitle(silent, LATER.getTime())).toBe(
      `No data for ${formatDuration(param.default * HOUR_MS)}`,
    );
    const groups = allGroupFreshness(
      hostNamed("atlas").lastRuns,
      LATER.getTime(),
    );
    expect(groups.every((group) => group.status !== "ok")).toBe(true);
    expect(missingDiskFaultIds()).toEqual(missingBefore);

    restore();
    expect(dumpDatabase()).toEqual(before);
  }, 60_000);

  it.each([
    ["collector-outdated", "is behind"],
    ["collector-incompatible", "is too old"],
  ] as const)(
    "opens %s from the versions producer",
    async (kind, phrase) => {
      const before = dumpDatabase();
      const styx = hostNamed("styx");
      await simulate("host", styx.id, kind, {}, LATER);

      const [opened] = faultsOf(kind, styx.id);
      expect(opened && faultTitle(opened)).toContain(phrase);
      const diary = listDiary({ subjectType: "host", subjectId: styx.id });
      expect(
        diary.some((entry) => entry.eventType === "collector-status-changed"),
      ).toBe(true);

      restore();
      expect(dumpDatabase()).toEqual(before);
    },
    60_000,
  );

  it("offers only versions below the minimum as incompatible", () => {
    const param = subjectScenarios("host", hostNamed("styx").id).scenarios.find(
      (scenario) => scenario.id === "collector-incompatible",
    )?.params[0];
    if (param?.kind !== "select") throw new Error("Expected a version select");
    for (const option of param.options) {
      expect(option.value < MIN_COLLECTOR_VERSION).toBe(true);
    }
  });
});

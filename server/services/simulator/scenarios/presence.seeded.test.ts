import { beforeAll, describe, expect, it } from "vitest";
import { faultTitle } from "#shared/faults";
import { listDiary } from "~~/server/services/diary";
import { getDisk, listDisks } from "~~/server/services/disks";
import { listFaults } from "~~/server/services/faults";
import { dumpDatabase } from "~~/test/db";
import { loadSeededDatabase, SEEDED_AT } from "~~/test/seeded";
import { restore, simulate, subjectScenarios } from "../run";

const NOW = SEEDED_AT;
const LATER = new Date(NOW.getTime() + 10 * 60 * 1000);

const liveFaults = () => listFaults({ state: ["open", "acknowledged"] }).faults;

function scenarioOf(diskId: number, scenarioId: string) {
  return subjectScenarios("disk", diskId).scenarios.find(
    (scenario) => scenario.id === scenarioId,
  );
}

/** The first `count` disks offering the scenario; offers are slow to build, so it stops there. */
async function disksOffering(scenarioId: string, count = 1) {
  const found = [];
  for (const row of await listDisks(NOW)) {
    if (!scenarioOf(row.id, scenarioId)) continue;
    found.push(row);
    if (found.length === count) break;
  }
  return found;
}

beforeAll(async () => {
  await loadSeededDatabase();
});

describe("presence scenarios", () => {
  it("shows in-service disks as missing, last seen hours ago", async () => {
    const before = dumpDatabase();
    const disks = await disksOffering("disk-missing", 2);
    expect(disks).toHaveLength(2);
    for (const row of disks) {
      await simulate("disk", row.id, "disk-missing", { hours: 48 }, LATER);
    }
    const missing = (await listDisks(LATER)).filter((row) =>
      disks.some((each) => each.id === row.id),
    );
    expect(missing.map((row) => row.state)).toEqual(disks.map(() => "missing"));
    const titles = liveFaults()
      .filter((fault) => fault.kind === "disk-missing")
      .map((fault) => faultTitle(fault, LATER.getTime()));
    expect(titles).toHaveLength(
      new Set(
        liveFaults()
          .filter((fault) => fault.kind === "disk-missing")
          .map((fault) => fault.subject.id),
      ).size,
    );
    expect(titles.every((title) => /^Missing, last seen \d/.test(title))).toBe(
      true,
    );
    restore();
    expect(dumpDatabase()).toEqual(before);
  }, 120_000);

  it("opens an identity conflict with the chosen disk", async () => {
    const before = dumpDatabase();
    const [target] = await disksOffering("identity-conflict");
    if (!target) throw new Error("No disk offers identity-conflict");
    const param = scenarioOf(target.id, "identity-conflict")?.params[0];
    if (param?.kind !== "select") throw new Error("Expected a disk select");
    const partner = Number(param.default);
    expect(partner).toBeGreaterThan(target.id);

    await simulate("disk", target.id, "identity-conflict", {}, LATER);
    const conflict = liveFaults().find(
      (fault) => fault.kind === "identity-conflict",
    );
    expect(conflict?.subject.id).toBe(target.id);
    expect(conflict && faultTitle(conflict)).toBe(
      `Identity conflict with disk ${partner}`,
    );
    const diary = listDiary({ subjectType: "disk", subjectId: target.id });
    expect(diary.map((entry) => entry.eventType)).toContain(
      "identity-conflict",
    );
    expect(diary.map((entry) => entry.eventType)).not.toContain("alias-drift");

    restore();
    expect(dumpDatabase()).toEqual(before);
  }, 60_000);

  it("leaves the disk as it was when smartctl cannot open it", async () => {
    const before = dumpDatabase();
    const [target] = await disksOffering("smartctl-unreadable");
    if (!target) throw new Error("No disk offers smartctl-unreadable");

    await simulate("disk", target.id, "smartctl-unreadable", {}, LATER);
    const opened = await getDisk(target.id, LATER);
    expect(opened.latestReadingAt).toEqual(target.latestReadingAt);
    restore();

    await simulate(
      "disk",
      target.id,
      "smartctl-unreadable",
      { exitStatus: "4" },
      LATER,
    );
    const failed = await getDisk(target.id, LATER);
    expect(failed.latestReadingAt).toEqual(LATER);
    expect(failed.latestStatus).toBe("unknown");

    restore();
    expect(dumpDatabase()).toEqual(before);
  }, 60_000);
});

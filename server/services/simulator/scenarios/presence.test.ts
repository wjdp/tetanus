import { beforeAll, describe, expect, it } from "vitest";
import { faultTitle } from "#shared/faults";
import { seed } from "~~/server/demo/seed";
import { DEMO_EPOCH, HOUR_MS } from "~~/server/demo/timeline";
import { getDisk, listDisks } from "~~/server/services/disks";
import { listFaults } from "~~/server/services/faults";
import { dumpDatabase } from "~~/test/db";
import { restore, simulate, subjectScenarios } from "../run";

const NOW = new Date(DEMO_EPOCH.getTime() + 2 * HOUR_MS);
const LATER = new Date(NOW.getTime() + 10 * 60 * 1000);

const liveFaults = () => listFaults({ state: ["open", "acknowledged"] }).faults;

function scenarioOf(diskId: number, scenarioId: string) {
  return subjectScenarios("disk", diskId).scenarios.find(
    (scenario) => scenario.id === scenarioId,
  );
}

async function inServiceDisks() {
  return (await listDisks(NOW)).filter(
    (row) => subjectScenarios("disk", row.id).scenarios.length > 0,
  );
}

beforeAll(async () => {
  await seed(NOW, { replay: "short" });
}, 120_000);

describe("presence scenarios", () => {
  it("shows every in-service disk as missing, last seen hours ago", async () => {
    const before = dumpDatabase();
    const disks = (await inServiceDisks()).filter((row) =>
      scenarioOf(row.id, "disk-missing"),
    );
    expect(disks.length).toBeGreaterThan(0);
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
    const target = (await inServiceDisks()).find((row) =>
      scenarioOf(row.id, "identity-conflict"),
    );
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
    const { diary } = await getDisk(target.id, LATER);
    expect(diary.map((entry) => entry.eventType)).toContain(
      "identity-conflict",
    );
    expect(diary.map((entry) => entry.eventType)).not.toContain("alias-drift");

    restore();
    expect(dumpDatabase()).toEqual(before);
  }, 60_000);

  it("leaves the disk as it was when smartctl cannot open it", async () => {
    const before = dumpDatabase();
    const target = (await inServiceDisks()).find((row) =>
      scenarioOf(row.id, "smartctl-unreadable"),
    );
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

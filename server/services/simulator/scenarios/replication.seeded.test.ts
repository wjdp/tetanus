import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { runAlertsPass } from "~~/server/services/alerts/dispatch";
import { listFaults } from "~~/server/services/faults";
import { listReplications } from "~~/server/services/replications";
import { dumpDatabase } from "~~/test/db";
import { loadSeededDatabase, SEEDED_AT } from "~~/test/seeded";
import { restore, simulate, subjectScenarios } from "../run";

const LATER = new Date(SEEDED_AT.getTime() + 10 * 60 * 1000);

let pristine: ReturnType<typeof dumpDatabase>;

function replicationInto(target: string) {
  const found = listReplications(LATER).find(
    (row) => row.target.dataset.name === target,
  );
  if (!found) throw new Error(`No replication into ${target}`);
  return found;
}

const statusOf = (id: number) =>
  listReplications(LATER).find((row) => row.id === id)?.status;

const scenariosOf = (id: number) => subjectScenarios("replication", id);

const ids = (id: number) =>
  scenariosOf(id).scenarios.map((scenario) => scenario.id);

const openKinds = (id: number) =>
  listFaults({ state: ["open", "acknowledged", "accepted"] })
    .faults.filter(
      (fault) =>
        fault.subject.type === "replication" && fault.subject.id === id,
    )
    .map((fault) => fault.kind);

beforeAll(async () => {
  await loadSeededDatabase();
  await runAlertsPass(LATER);
  pristine = dumpDatabase();
}, 120_000);

afterEach(() => {
  restore();
  expect(dumpDatabase()).toEqual(pristine);
});

describe("replication scenarios", () => {
  it("offers late and stalled by band, and destruction of monitored datasets", () => {
    const ok = replicationInto("vault/replica/tank/photos");
    expect(ok.status).toBe("ok");
    expect(ids(ok.id)).toEqual([
      "replication-late",
      "replication-stalled",
      "replication-target-destroyed",
      "replication-source-destroyed",
    ]);

    const late = replicationInto("vault/replica/tank/media/music");
    expect(late.status).toBe("late");
    expect(ids(late.id)).not.toContain("replication-late");
    expect(ids(late.id)).toContain("replication-stalled");
  });

  it("defaults to just past each threshold", () => {
    const { id, intervalSec } = replicationInto("vault/replica/tank/photos");
    expect(intervalSec).not.toBeNull();
    const hours = (scenario: string) =>
      scenariosOf(id).scenarios.find((each) => each.id === scenario)?.params[0]
        ?.default;
    expect(hours("replication-late")).toBeGreaterThan(0);
    expect(hours("replication-stalled")).toBeGreaterThan(
      Number(hours("replication-late")),
    );
  });

  it("runs late, then stalled superseding it", async () => {
    const { id } = replicationInto("vault/replica/tank/photos");
    await simulate("replication", id, "replication-late", {}, LATER);
    expect(statusOf(id)).toBe("late");
    expect(openKinds(id)).toEqual(["replication-late"]);

    await simulate("replication", id, "replication-stalled", {}, LATER);
    expect(statusOf(id)).toBe("stalled");
    expect(openKinds(id)).toEqual(["replication-stalled"]);
  }, 60_000);

  it.each([["replication-target-destroyed"], ["replication-source-destroyed"]])(
    "%s leaves the replication gone",
    async (scenario) => {
      const { id } = replicationInto("vault/replica/tank/photos");
      await simulate("replication", id, scenario, {}, LATER);
      expect(statusOf(id)).toBe("gone");
      expect(ids(id)).not.toContain(scenario);
    },
    60_000,
  );
});

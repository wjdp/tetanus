import { $fetch, fetch, setup } from "@nuxt/test-utils/e2e";
import { afterAll, describe, expect, it } from "vitest";
import { createDb } from "~~/server/database/client";
import { runMigrations } from "~~/server/database/migrate";
import { payload } from "~~/server/database/schema";
import type { FaultsResponse } from "~~/shared/faults";
import { HOST_HEADER } from "~~/shared/ingest";
import type { Settings } from "~~/shared/schemas/settings";
import type { SimulatorStatus, SubjectScenarios } from "~~/shared/simulator";
import { readFixture } from "~~/test/fixtures";
import { createTestDatabaseFile, startNuxtServer } from "./devServer";

const databaseFile = createTestDatabaseFile();
const { sqlite, db } = createDb(databaseFile);
runMigrations(sqlite, db);

const server = await startNuxtServer(databaseFile);
afterAll(() => {
  server.stop();
  sqlite.close();
});

await setup({ host: server.host });

const { enrolToken }: Settings = await (await fetch("/api/settings")).json();
const SDB = readFixture("mars/smartctl/xall-sdb-auto.json");

async function ingestSdb() {
  const response = await fetch(
    "/api/ingest/smartctl-xall?device=/dev/sdb&exitStatus=0",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${enrolToken}`,
        [HOST_HEADER]: "mars",
        "content-type": "text/plain",
      },
      body: SDB,
    },
  );
  expect(response.status).toBe(200);
}

const liveFaults = () =>
  $fetch<FaultsResponse>("/api/faults").then((response) => response.faults);

describe("fault simulator routes", () => {
  it("simulates a fault on a disk and restores everything", async () => {
    await ingestSdb();
    const disks = await $fetch<{ id: number }[]>("/api/disks");
    const diskId = disks[0].id;
    const faultsBefore = await liveFaults();

    const offered = await $fetch<SubjectScenarios>(
      `/api/simulate/disk/${diskId}`,
    );
    const failed = offered.scenarios.find(
      (scenario) => scenario.id === "smart-health-failed",
    );
    expect(failed).toBeDefined();
    expect(offered.simulations).toEqual([]);

    const status = await $fetch<SimulatorStatus>(
      `/api/simulate/disk/${diskId}`,
      { method: "POST", body: { scenario: "smart-health-failed" } },
    );
    expect(status.simulations.map((row) => row.scenario)).toEqual([
      "smart-health-failed",
    ]);
    expect(
      (await liveFaults()).some(
        (fault) =>
          fault.kind === "smart-health-failed" && fault.subject.id === diskId,
      ),
    ).toBe(true);

    const restored = await $fetch<SimulatorStatus>("/api/simulate/restore", {
      method: "POST",
    });
    expect(restored.simulations).toEqual([]);
    expect(await liveFaults()).toEqual(faultsBefore);
    expect(db.select({ body: payload.body }).from(payload).all()).toEqual([
      { body: SDB },
    ]);
  });

  it("rejects a scenario that does not apply", async () => {
    const disks = await $fetch<{ id: number }[]>("/api/disks");
    const response = await fetch(`/api/simulate/disk/${disks[0].id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scenario: "no-such-scenario" }),
    });
    expect(response.status).toBe(400);
  });
});

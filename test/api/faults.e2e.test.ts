import { $fetch, fetch, setup } from "@nuxt/test-utils/e2e";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";
import { createDb } from "~~/server/database/client";
import { runMigrations } from "~~/server/database/migrate";
import { collectorRun, fault, host, pool } from "~~/server/database/schema";
import type { FaultsResponse, FaultView } from "~~/shared/faults";
import { HOST_HEADER } from "~~/shared/ingest";
import type { Settings } from "~~/shared/schemas/settings";
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

function withAttributeRaw(body: string, attrId: number, raw: number) {
  const json = JSON.parse(body);
  const attribute = json.ata_smart_attributes.table.find(
    (row: { id: number }) => row.id === attrId,
  );
  attribute.raw = { value: raw, string: String(raw) };
  return JSON.stringify(json);
}

const K2_WITH_PENDING_SECTORS_ONLY = withAttributeRaw(
  readFixture("mars/smartctl/xall-sdb-auto.json"),
  198,
  0,
);

async function ingestK2() {
  const response = await fetch(
    "/api/ingest/smartctl-xall?device=/dev/sdb&exitStatus=0",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${enrolToken}`,
        [HOST_HEADER]: "mars",
        "content-type": "text/plain",
      },
      body: K2_WITH_PENDING_SECTORS_ONLY,
    },
  );
  expect(response.status).toBe(200);
}

async function runAlertsTick() {
  await $fetch("/api/tasks", {
    method: "POST",
    body: { taskName: "alerts:tick" },
  });
}

function getFaults(query = ""): Promise<FaultsResponse> {
  return $fetch<FaultsResponse>(`/api/faults${query}`);
}

function kinds(response: FaultsResponse) {
  return response.faults.map((row) => row.kind).sort();
}

function action(
  id: number,
  name: "acknowledge" | "accept" | "clear",
  note?: string,
) {
  if (name === "clear") {
    return fetch(`/api/faults/${id}/acknowledgement`, { method: "DELETE" });
  }
  return fetch(`/api/faults/${id}/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(note === undefined ? {} : { note }),
  });
}

interface SmartOverview {
  attributes: {
    attrId: string;
    displayStatus: string;
    acceptance: { kind: string; note: string } | null;
  }[];
}

async function attribute197(diskId: number) {
  const smart: SmartOverview = await (
    await fetch(`/api/disks/${diskId}/smart`)
  ).json();
  return smart.attributes.find((candidate) => candidate.attrId === "197");
}

await ingestK2();
const now = new Date();
const mars = db.select().from(host).where(eq(host.name, "mars")).get();
if (!mars) throw new Error("mars was not created by ingest");
db.insert(pool)
  .values({
    hostId: mars.id,
    guid: "123",
    name: "vault",
    state: "DEGRADED",
    firstSeenAt: now,
    lastSeenAt: now,
  })
  .run();
db.insert(collectorRun)
  .values({
    hostId: mars.id,
    source: "zpool-status",
    receivedAt: now,
    ok: true,
    bytes: 0,
  })
  .run();
db.insert(host)
  .values({
    name: "venus",
    firstSeenAt: now,
    lastSeenAt: now,
    collectorVersion: "0.0.1",
    collectorStatus: "outdated",
  })
  .run();

await runAlertsTick();
await vi.waitFor(
  async () => {
    expect(kinds(await getFaults())).toEqual(
      expect.arrayContaining([
        "collector-outdated",
        "collector-silent",
        "pool-degraded",
        "smart-attribute",
      ]),
    );
  },
  { timeout: 10000, interval: 100 },
);

async function findFault(kind: FaultView["kind"], query = "") {
  const found = (await getFaults(query)).faults.find(
    (row) => row.kind === kind,
  );
  if (!found) throw new Error(`no ${kind} fault`);
  return found;
}

const pendingSectors = (await getFaults("?category=disk")).faults.find(
  (row) => row.kind === "smart-attribute" && row.data.attrId === "197",
) as FaultView;
const degraded = await findFault("pool-degraded", "");
const outdated = await findFault("collector-outdated", "");

describe("GET /api/faults", () => {
  it("lists live faults by default with counts and the open-error badge", async () => {
    const response = await getFaults();
    expect(
      response.faults.every((row) =>
        ["open", "acknowledged"].includes(row.state),
      ),
    ).toBe(true);
    expect(pendingSectors).toMatchObject({
      category: "disk",
      severity: "error",
      state: "open",
      subject: { type: "disk", hostName: "mars" },
    });
    expect(degraded).toMatchObject({
      severity: "warning",
      data: { state: "DEGRADED", poolName: "vault" },
      subject: { type: "pool", label: "vault", hostName: "mars" },
    });
    expect(response.counts).toEqual({
      open: response.faults.length,
      acknowledged: 0,
      accepted: 0,
      resolved: 0,
    });
    const openErrors = response.faults.filter(
      (row) => row.severity === "error",
    ).length;
    expect(response.badge).toBe(openErrors);
    expect(openErrors).toBeGreaterThanOrEqual(2);
  });

  it("filters by category, severity, host and state", async () => {
    expect(kinds(await getFaults("?category=zfs"))).toEqual(["pool-degraded"]);
    const warnings = await getFaults("?severity=warning");
    expect(warnings.faults.every((row) => row.severity === "warning")).toBe(
      true,
    );
    expect(kinds(warnings)).toEqual(
      expect.arrayContaining(["collector-outdated", "pool-degraded"]),
    );
    expect(kinds(await getFaults("?host=venus"))).toEqual([
      "collector-outdated",
      "collector-silent",
    ]);

    const resolved = await getFaults("?state=resolved&category=zfs");
    expect(resolved.faults).toEqual([]);
    expect(resolved.counts).toMatchObject({ open: 1, resolved: 0 });
    const badge = (await getFaults()).badge;
    expect(resolved.badge).toBe(badge);
  });

  it("400s for an invalid state", async () => {
    expect((await fetch("/api/faults?state=dismissed")).status).toBe(400);
    expect((await fetch("/api/faults?state=")).status).toBe(400);
  });
});

describe("fault actions", () => {
  it("acknowledges, accepts and clears a pool fault", async () => {
    const acknowledged = await action(degraded.id, "acknowledge", "on it");
    expect(acknowledged.status).toBe(200);
    expect(await acknowledged.json()).toMatchObject({
      state: "acknowledged",
      note: "on it",
    });
    const live = await getFaults("?category=zfs");
    expect(live.faults).toMatchObject([{ state: "acknowledged" }]);
    expect(live.counts).toMatchObject({ open: 0, acknowledged: 1 });

    expect((await action(degraded.id, "accept", "leaf offline")).status).toBe(
      200,
    );
    expect((await getFaults("?category=zfs")).faults).toEqual([]);
    expect(
      (await getFaults("?state=accepted&category=zfs")).faults,
    ).toMatchObject([{ state: "accepted", note: "leaf offline" }]);

    const cleared = await action(degraded.id, "clear");
    expect(cleared.status).toBe(200);
    expect(await cleared.json()).toMatchObject({ state: "open", note: "" });
  });

  it("mirrors SMART attribute actions in the disk's acceptances", async () => {
    const diskId = pendingSectors.subject.id;
    const badgeBefore = (await getFaults()).badge;

    expect((await action(pendingSectors.id, "accept", "stable")).status).toBe(
      200,
    );
    expect(await attribute197(diskId)).toMatchObject({
      displayStatus: "accepted",
      acceptance: { kind: "accept", note: "stable" },
    });
    expect(
      (await getFaults("?state=accepted&category=disk")).faults,
    ).toMatchObject([{ id: pendingSectors.id, note: "stable" }]);
    expect((await getFaults()).badge).toBe(badgeBefore - 1);

    expect((await action(pendingSectors.id, "clear")).status).toBe(200);
    expect(await attribute197(diskId)).toMatchObject({ acceptance: null });

    const acknowledged = await action(pendingSectors.id, "acknowledge");
    expect(acknowledged.status).toBe(200);
    expect(await acknowledged.json()).toMatchObject({ state: "acknowledged" });
    expect(await attribute197(diskId)).toMatchObject({
      displayStatus: "acknowledged",
      acceptance: { kind: "acknowledge" },
    });
  });

  it("409s for an action the kind or state does not allow", async () => {
    expect((await action(outdated.id, "accept")).status).toBe(409);
    expect((await action(outdated.id, "clear")).status).toBe(409);

    db.update(fault)
      .set({ state: "resolved", resolvedAt: new Date() })
      .where(eq(fault.id, outdated.id))
      .run();
    expect((await action(outdated.id, "acknowledge")).status).toBe(409);
  });

  it("404s for an unknown fault and 400s for a bad id", async () => {
    expect((await action(999999, "acknowledge")).status).toBe(404);
    expect(
      (await fetch("/api/faults/nope/accept", { method: "POST" })).status,
    ).toBe(400);
  });
});

describe("faults:backfill", () => {
  it("runs at boot and again from the task queue, keeping fault states", async () => {
    const backfilledAt = async () =>
      ((await (await fetch("/api/settings")).json()) as Settings).config
        .faultsBackfilledAt;
    await vi.waitFor(async () => expect(await backfilledAt()).toBeTruthy(), {
      timeout: 10000,
      interval: 100,
    });
    const before = await backfilledAt();

    await $fetch("/api/tasks", {
      method: "POST",
      body: { taskName: "faults:backfill" },
    });
    await vi.waitFor(
      async () => expect(await backfilledAt()).not.toBe(before),
      { timeout: 10000, interval: 100 },
    );

    const live = await getFaults();
    expect(
      live.faults.find((row) => row.kind === "smart-attribute"),
    ).toMatchObject({ state: "acknowledged" });
    expect(
      live.faults.find((row) => row.kind === "pool-degraded"),
    ).toMatchObject({ state: "open" });
  });
});

import { fetch, setup } from "@nuxt/test-utils/e2e";
import { afterAll, describe, expect, it } from "vitest";
import { createDb } from "~~/server/database/client";
import { runMigrations } from "~~/server/database/migrate";
import { HOST_HEADER } from "~~/shared/ingest";
import type { Settings } from "~~/shared/schemas/settings";
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

function ingest(
  path: string,
  body: string,
  headers: Record<string, string> = {},
) {
  return fetch(path, {
    method: "POST",
    headers: {
      authorization: `Bearer ${enrolToken}`,
      [HOST_HEADER]: "Mars",
      "content-type": "text/plain",
      "user-agent": "tetanus-collect/test",
      ...headers,
    },
    body,
  });
}

type HostRow = { id: number; name: string; toolVersions: string };
type PayloadRow = { source: string; device: string; body: string };
type CollectorRunRow = {
  source: string;
  device: string | null;
  ok: 0 | 1;
  error: string | null;
  bytes: number;
  producer: string | null;
};

function hostNamed(name: string) {
  return sqlite
    .prepare("SELECT * FROM Host WHERE name = ?")
    .get(name) as HostRow;
}

function payloadsOf(hostId: number) {
  return sqlite
    .prepare("SELECT * FROM Payload WHERE hostId = ? ORDER BY id")
    .all(hostId) as PayloadRow[];
}

function runsOf(hostId: number) {
  return sqlite
    .prepare("SELECT * FROM CollectorRun WHERE hostId = ? ORDER BY id")
    .all(hostId) as CollectorRunRow[];
}

describe("POST /api/ingest/:source", () => {
  it("401s without a token", async () => {
    const response = await ingest("/api/ingest/versions", "zfs=1", {
      authorization: "",
    });
    expect(response.status).toBe(401);
  });

  it("401s with the wrong token", async () => {
    const response = await ingest("/api/ingest/versions", "zfs=1", {
      authorization: "Bearer wrong",
    });
    expect(response.status).toBe(401);
  });

  it("400s for an invalid host name", async () => {
    const response = await ingest("/api/ingest/versions", "zfs=1", {
      [HOST_HEADER]: "not a host",
    });
    expect(response.status).toBe(400);
  });

  it("400s for an unknown source", async () => {
    const response = await ingest("/api/ingest/nope", "zfs=1");
    expect(response.status).toBe(400);
  });

  it("400s for an out-of-range exit status", async () => {
    const response = await ingest("/api/ingest/versions?exitStatus=256", "");
    expect(response.status).toBe(400);
  });

  it("records versions, the host and one payload", async () => {
    const first = await ingest("/api/ingest/versions", "zfs=2.4.0\n");
    expect(first.status).toBe(200);
    const second = await ingest(
      "/api/ingest/versions",
      "zfs=2.4.1\nkernel=6.8\n",
    );
    expect(await second.json()).toEqual({
      ok: true,
      source: "versions",
      host: "mars",
      summary: { keys: 2 },
    });

    const mars = hostNamed("mars");
    expect(JSON.parse(mars.toolVersions)).toEqual({
      zfs: "2.4.1",
      kernel: "6.8",
    });
    expect(payloadsOf(mars.id)).toEqual([
      expect.objectContaining({
        source: "versions",
        device: "",
        body: "zfs=2.4.1\nkernel=6.8\n",
      }),
    ]);
    const runs = runsOf(mars.id);
    expect(runs.map((run) => run.source)).toEqual(["versions", "versions"]);
    expect(runs.at(-1)).toMatchObject({
      ok: 1,
      bytes: 21,
      producer: "tetanus-collect/test",
    });
  });

  it("422s and records a failed run when parsing fails", async () => {
    const response = await ingest(
      "/api/ingest/lsblk?device=%2Fdev%2Fsdc",
      "not json",
      { [HOST_HEADER]: "venus" },
    );
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      ok: false,
      error: expect.any(String),
    });

    const venus = hostNamed("venus");
    expect(runsOf(venus.id)).toEqual([
      expect.objectContaining({
        source: "lsblk",
        device: "/dev/sdc",
        ok: 0,
        error: expect.any(String),
      }),
    ]);
    expect(payloadsOf(venus.id)).toEqual([]);
  });
});

type HostListing = {
  name: string;
  lastRuns: Record<string, { ok: boolean }>;
};

describe("/api/hosts", () => {
  it("lists hosts with their last run per source", async () => {
    await ingest("/api/ingest/versions", "zfs=1", { [HOST_HEADER]: "jupiter" });
    const hosts: HostListing[] = await (await fetch("/api/hosts")).json();
    const jupiter = hosts.find((row) => row.name === "jupiter")!;
    expect(jupiter.lastRuns.versions).toMatchObject({ ok: true });
  });

  it("gets and patches a host", async () => {
    await ingest("/api/ingest/versions", "zfs=1", { [HOST_HEADER]: "saturn" });
    const hostPath: string = `/api/hosts/${hostNamed("saturn").id}`;

    const patched = await fetch(hostPath, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: "Saturn", notes: "Loft" }),
    });
    expect(await patched.json()).toMatchObject({
      displayName: "Saturn",
      notes: "Loft",
    });
    expect(await (await fetch(hostPath)).json()).toMatchObject({
      name: "saturn",
      displayName: "Saturn",
    });
  });

  it("404s for a missing host", async () => {
    expect((await fetch("/api/hosts/99999")).status).toBe(404);
  });

  it("400s for an invalid patch", async () => {
    await ingest("/api/ingest/versions", "zfs=1", { [HOST_HEADER]: "pluto" });
    const { id } = hostNamed("pluto");
    const response = await fetch(`/api/hosts/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "renamed" }),
    });
    expect(response.status).toBe(400);
  });
});

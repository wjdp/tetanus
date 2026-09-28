import { beforeEach, describe, expect, it } from "vitest";
import { db } from "~~/server/database/client";
import { collectorRun, host } from "~~/server/database/schema";
import {
  getHost,
  listHosts,
  setToolVersions,
  updateHost,
  upsertHostByName,
} from "~~/server/services/hosts";
import { flushDb } from "~~/test/db";

const firstSeen = new Date("2026-09-01T10:00:00Z");
const laterSeen = new Date("2026-09-02T10:00:00Z");

function recordRun(
  hostId: number,
  source: string,
  receivedAt: Date,
  ok = true,
) {
  db.insert(collectorRun)
    .values({
      hostId,
      source,
      receivedAt,
      ok,
      error: ok ? null : "broken",
      bytes: 10,
    })
    .run();
}

describe("hosts", () => {
  beforeEach(() => {
    flushDb();
  });

  it("creates a host on first sight", () => {
    const mars = upsertHostByName("mars", firstSeen);
    expect(mars).toMatchObject({
      name: "mars",
      displayName: null,
      toolVersions: {},
      healthchecksUrl: null,
      notes: "",
      firstSeenAt: firstSeen,
      lastSeenAt: firstSeen,
    });
  });

  it("bumps lastSeenAt and keeps firstSeenAt on later sightings", () => {
    const first = upsertHostByName("mars", firstSeen);
    const second = upsertHostByName("mars", laterSeen);
    expect(second).toMatchObject({
      id: first.id,
      firstSeenAt: firstSeen,
      lastSeenAt: laterSeen,
    });
    expect(db.select().from(host).all()).toHaveLength(1);
  });

  it("lists hosts by name with the last run per source", () => {
    const venus = upsertHostByName("venus", firstSeen);
    const mars = upsertHostByName("mars", firstSeen);
    recordRun(mars.id, "lsblk", firstSeen);
    recordRun(mars.id, "lsblk", laterSeen, false);
    recordRun(mars.id, "versions", firstSeen);
    recordRun(venus.id, "lsblk", firstSeen);

    const hosts = listHosts();

    expect(hosts.map((row) => row.name)).toEqual(["mars", "venus"]);
    expect(hosts[0].lastRuns).toEqual({
      lsblk: {
        receivedAt: laterSeen,
        ok: false,
        error: "broken",
        device: null,
      },
      versions: { receivedAt: firstSeen, ok: true, error: null, device: null },
    });
    expect(Object.keys(hosts[1].lastRuns)).toEqual(["lsblk"]);
  });

  it("gets one host with its runs", () => {
    const mars = upsertHostByName("mars", firstSeen);
    recordRun(mars.id, "lsblk", firstSeen);
    expect(getHost(mars.id)).toMatchObject({
      name: "mars",
      lastRuns: { lsblk: { ok: true } },
    });
  });

  it("404s for a missing host", () => {
    expect(() => getHost(999)).toThrow(
      expect.objectContaining({ statusCode: 404 }),
    );
    expect(() => updateHost(999, { notes: "x" })).toThrow(
      expect.objectContaining({ statusCode: 404 }),
    );
  });

  it("updates editable fields only", () => {
    const mars = upsertHostByName("mars", firstSeen);
    const updated = updateHost(mars.id, {
      displayName: "Mars",
      healthchecksUrl: "https://hc-ping.com/abc",
      notes: "Rack 1",
    });
    expect(updated).toMatchObject({
      name: "mars",
      displayName: "Mars",
      healthchecksUrl: "https://hc-ping.com/abc",
      notes: "Rack 1",
    });
    expect(updateHost(mars.id, { displayName: null }).displayName).toBeNull();
  });

  it("returns the host unchanged for an empty patch", () => {
    const mars = upsertHostByName("mars", firstSeen);
    expect(updateHost(mars.id, {})).toMatchObject({ id: mars.id });
  });

  it("replaces tool versions", () => {
    const mars = upsertHostByName("mars", firstSeen);
    setToolVersions(mars.id, { zfs: "2.4.1", kernel: "6.8" });
    setToolVersions(mars.id, { zfs: "2.4.2" });
    expect(getHost(mars.id).toolVersions).toEqual({ zfs: "2.4.2" });
  });
});

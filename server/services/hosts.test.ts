import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "~~/server/database/client";
import { collectorRun, host } from "~~/server/database/schema";
import { listDiary } from "~~/server/services/diary";
import {
  getHost,
  listHosts,
  recordCollectorVersion,
  reorderHosts,
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

  it("stores temperature thresholds and clears them with null", () => {
    const mars = upsertHostByName("mars", firstSeen);
    const temperatureThresholds = { ssd: { warning: 65, error: 75 } };
    expect(
      updateHost(mars.id, { temperatureThresholds }).temperatureThresholds,
    ).toEqual(temperatureThresholds);
    expect(getHost(mars.id).temperatureThresholds).toEqual(
      temperatureThresholds,
    );
    expect(
      updateHost(mars.id, { temperatureThresholds: null })
        .temperatureThresholds,
    ).toBeNull();
  });

  it("returns the host unchanged for an empty patch", () => {
    const mars = upsertHostByName("mars", firstSeen);
    expect(updateHost(mars.id, {})).toMatchObject({ id: mars.id });
  });

  it("clears the Healthchecks URL when marked intermittent", () => {
    const mars = upsertHostByName("mars", firstSeen);
    updateHost(mars.id, { healthchecksUrl: "https://hc-ping.com/abc" });
    expect(updateHost(mars.id, { intermittent: true })).toMatchObject({
      intermittent: true,
      healthchecksUrl: null,
    });
  });

  it("rejects a Healthchecks URL on an intermittent host", () => {
    const mars = upsertHostByName("mars", firstSeen);
    updateHost(mars.id, { intermittent: true });
    expect(() =>
      updateHost(mars.id, { healthchecksUrl: "https://hc-ping.com/abc" }),
    ).toThrow(expect.objectContaining({ statusCode: 400 }));
    expect(() =>
      updateHost(mars.id, {
        intermittent: true,
        healthchecksUrl: "https://hc-ping.com/abc",
      }),
    ).toThrow(expect.objectContaining({ statusCode: 400 }));
  });

  it("allows a Healthchecks URL once no longer intermittent", () => {
    const mars = upsertHostByName("mars", firstSeen);
    updateHost(mars.id, { intermittent: true });
    const healthchecksUrl = "https://hc-ping.com/abc";
    expect(
      updateHost(mars.id, { intermittent: false, healthchecksUrl }),
    ).toMatchObject({ intermittent: false, healthchecksUrl });
  });

  it("replaces tool versions", () => {
    const mars = upsertHostByName("mars", firstSeen);
    setToolVersions(mars.id, { zfs: "2.4.1", kernel: "6.8" });
    setToolVersions(mars.id, { zfs: "2.4.2" });
    expect(getHost(mars.id).toolVersions).toEqual({ zfs: "2.4.2" });
  });
});

describe("recordCollectorVersion", () => {
  beforeEach(() => {
    flushDb();
  });

  const record = (version: string) =>
    recordCollectorVersion(getHost(mars().id), version, laterSeen);
  const mars = () => upsertHostByName("mars", firstSeen);
  const events = () =>
    listDiary({ subjectType: "host" }).map(({ title, data }) => ({
      title,
      data,
    }));

  it.each(["0.3.0", "0.3.1"])(
    "records %s on first sight without a diary entry",
    (version) => {
      record(version);
      expect(getHost(mars().id).collectorVersion).toBe(version);
      expect(events()).toEqual([]);
    },
  );

  it("records an incompatible collector on first sight", () => {
    record("0.2.0");
    expect(getHost(mars().id).collectorStatus).toBe("incompatible");
    expect(events()).toEqual([
      {
        title: "Collector 0.2.0 incompatible (needs 0.3.0)",
        data: {
          from: "unknown",
          to: "incompatible",
          version: "0.2.0",
          minVersion: "0.3.0",
        },
      },
    ]);
  });

  it("records each status change once", () => {
    record("0.2.0");
    record("0.2.0");
    record("0.4.0");
    record("0.4.0");
    record("0.3.0");
    expect(events().map(({ title }) => title)).toEqual([
      "Collector 0.3.0 outdated",
      "Collector 0.4.0 current",
      "Collector 0.2.0 incompatible (needs 0.3.0)",
    ]);
  });

  it("records a raised minimum with the version unchanged", () => {
    const { id } = mars();
    db.update(host)
      .set({ collectorVersion: "0.2.0", collectorStatus: "current" })
      .where(eq(host.id, id))
      .run();
    record("0.2.0");
    expect(events()).toEqual([
      expect.objectContaining({
        data: expect.objectContaining({ from: "current", to: "incompatible" }),
      }),
    ]);
  });
});

describe("reorderHosts", () => {
  beforeEach(() => {
    flushDb();
  });

  it("lists hosts in the set order", () => {
    const mars = upsertHostByName("mars", firstSeen);
    const bench = upsertHostByName("bench", firstSeen);
    const venus = upsertHostByName("venus", firstSeen);
    const order = [venus.id, mars.id, bench.id];
    expect(reorderHosts(order).map((row) => row.id)).toEqual(order);
    expect(listHosts().map((row) => row.id)).toEqual(order);
  });

  it.each([
    ["a partial list", (ids: number[]) => ids.slice(1)],
    ["an unknown id", (ids: number[]) => [...ids.slice(1), 999]],
  ])("rejects %s", (_label, mutate) => {
    const ids = [
      upsertHostByName("mars", firstSeen).id,
      upsertHostByName("venus", firstSeen).id,
    ];
    expect(() => reorderHosts(mutate(ids))).toThrow(
      expect.objectContaining({ statusCode: 400 }),
    );
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "~~/server/database/client";
import { collectorRun } from "~~/server/database/schema";
import { pingHealthchecks } from "~~/server/services/healthchecks";
import { updateHost, upsertHostByName } from "~~/server/services/hosts";
import { flushDb } from "~~/test/db";

const now = new Date("2026-09-28T12:00:00Z");

function recordRun(hostId: number, source: string, receivedAt: Date) {
  db.insert(collectorRun)
    .values({ hostId, source, receivedAt, ok: true, error: null, bytes: 10 })
    .run();
}

function freshRuns(hostId: number) {
  for (const source of [
    "versions",
    "zpool-status",
    "zpool-list",
    "zfs-list",
    "zpool-history",
    "zpool-events",
    "vdev-id-conf",
    "lsblk",
    "udev",
    "smartctl-scan",
    "smartctl-xall",
    "zfs-snapshots",
  ]) {
    recordRun(hostId, source, now);
  }
}

function withHealthchecksUrl(hostId: number, url: string) {
  updateHost(hostId, { healthchecksUrl: url });
}

describe("pingHealthchecks", () => {
  beforeEach(() => {
    flushDb();
  });

  it("GETs the URL when every group is fresh", async () => {
    const mars = upsertHostByName("mars", now);
    withHealthchecksUrl(mars.id, "https://hc-ping.com/mars");
    freshRuns(mars.id);

    const fetchImpl = vi.fn().mockResolvedValue(new Response());
    await pingHealthchecks(now, fetchImpl);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://hc-ping.com/mars");
    expect(options?.method ?? "GET").toBe("GET");
  });

  it("POSTs /fail with a body listing stale groups when any group is stale", async () => {
    const mars = upsertHostByName("mars", now);
    withHealthchecksUrl(mars.id, "https://hc-ping.com/mars");
    // No runs recorded at all: every group is "error" (never seen).

    const fetchImpl = vi.fn().mockResolvedValue(new Response());
    await pingHealthchecks(now, fetchImpl);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://hc-ping.com/mars/fail");
    expect(options?.method).toBe("POST");
    expect(options?.body).toBe(
      "zfs: error (never), smart: error (never), snapshots: error (never)",
    );
  });

  it("swallows network errors and continues", async () => {
    const mars = upsertHostByName("mars", now);
    withHealthchecksUrl(mars.id, "https://hc-ping.com/mars");

    const fetchImpl = vi.fn().mockRejectedValue(new Error("network down"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(pingHealthchecks(now, fetchImpl)).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("skips hosts with no healthchecks URL", async () => {
    upsertHostByName("mars", now);

    const fetchImpl = vi.fn();
    await pingHealthchecks(now, fetchImpl);

    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

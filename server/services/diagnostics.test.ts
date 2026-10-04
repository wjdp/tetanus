import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "~~/server/database/client";
import { disk, smartReading } from "~~/server/database/schema";
import {
  buildDiskDiagnostics,
  type DiagnosticsBundle,
  diagnosticsName,
} from "~~/server/services/diagnostics";
import { getDisk } from "~~/server/services/disks";
import { recordIngest } from "~~/server/services/ingest";
import { flushDb } from "~~/test/db";
import { replayBundle } from "~~/test/diagnostics";
import { readFixture, readFixtureExit } from "~~/test/fixtures";

const T0 = new Date("2026-09-28T22:10:16Z");
const NOW = new Date("2026-09-29T09:00:00Z");
const SDB = "mars/smartctl/xall-sdb-auto.json";

function ingest(
  source: string,
  body: string,
  meta: Parameters<typeof recordIngest>[0]["meta"] = {},
  receivedAt = T0,
) {
  const outcome = recordIngest({
    hostName: "mars",
    source,
    meta,
    body,
    receivedAt,
  });
  expect(outcome).toMatchObject({ ok: true });
}

function ingestMars() {
  ingest("versions", "zfs=2.4.1\nkernel=7.0.0\n");
  ingest("lsblk", readFixture("mars/lsblk.json"));
  ingest("udev", readFixture("mars/udev/b8-16.txt"), { device: "b8:16" });
  ingest("udev", readFixture("mars/udev/b8-32.txt"), { device: "b8:32" });
  ingest("smartctl-scan", readFixture("mars/smartctl-scan.json"));
  ingest("smartctl-xall", readFixture(SDB), {
    device: "/dev/sdb",
    type: "auto",
    exitStatus: readFixtureExit(SDB),
  });
  ingest("smartctl-xall", readFixture("mars/smartctl/xall-sdc.json"), {
    device: "/dev/sdc",
    exitStatus: readFixtureExit("mars/smartctl/xall-sdc.json"),
  });
  ingest("zpool-status", readFixture("mars/zpool-status.json"));
  ingest("vdev-id-conf", readFixture("mars/vdev-id-conf.txt"));
}

function sdbId() {
  const serial = JSON.parse(readFixture(SDB)).serial_number as string;
  return (
    db.select().from(disk).where(eq(disk.serial, serial)).get() as {
      id: number;
    }
  ).id;
}

function writeBundle(bundle: DiagnosticsBundle) {
  const root = mkdtempSync(join(tmpdir(), "tetanus-diagnostics-"));
  for (const [path, body] of Object.entries(bundle)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), body);
  }
  return root;
}

function comparable(summary: Awaited<ReturnType<typeof getDisk>>) {
  const { id: _id, lastSeenHostId: _host, keys, membership, ...rest } = summary;
  return {
    ...rest,
    keys: [...keys].sort((a, b) =>
      `${a.kind}:${a.value}`.localeCompare(`${b.kind}:${b.value}`),
    ),
    membership: membership && { ...membership, poolId: undefined },
  };
}

beforeEach(() => {
  flushDb();
});

describe("buildDiskDiagnostics", () => {
  it("names the bundle after the disk and date", () => {
    expect(diagnosticsName(30, NOW)).toBe("tetanus-disk-30-2026-09-29");
  });

  it("carries the db view and every disk payload on the host", async () => {
    ingestMars();
    const bundle = await buildDiskDiagnostics(sdbId(), {
      now: NOW,
      appVersion: "1.2.3",
    });

    expect(Object.keys(bundle).sort()).toEqual([
      "README.md",
      "db/acceptances.json",
      "db/collector-runs.json",
      "db/diary.json",
      "db/disk.json",
      "db/host.json",
      "db/keys.json",
      "db/membership.json",
      "db/self-tests.json",
      "db/smart-attributes.json",
      "db/smart-readings.json",
      "db/summary.json",
      "db/temperatures.json",
      "meta.json",
      "raw/mars/lsblk.json",
      "raw/mars/manifest.json",
      "raw/mars/smartctl-scan.json",
      "raw/mars/smartctl/xall-sdb-auto.exit",
      "raw/mars/smartctl/xall-sdb-auto.json",
      "raw/mars/smartctl/xall-sdc.exit",
      "raw/mars/smartctl/xall-sdc.json",
      "raw/mars/udev/b8-16.txt",
      "raw/mars/udev/b8-32.txt",
      "raw/mars/vdev-id-conf.txt",
      "raw/mars/versions.txt",
      "raw/mars/zpool-status.json",
    ]);
    expect(bundle["raw/mars/lsblk.json"]).toBe(readFixture("mars/lsblk.json"));
    expect(bundle["raw/mars/smartctl/xall-sdb-auto.json"]).toBe(
      readFixture(SDB),
    );
    expect(bundle["raw/mars/udev/b8-32.txt"]).toBe(
      readFixture("mars/udev/b8-32.txt"),
    );
    expect(JSON.parse(bundle["meta.json"])).toMatchObject({
      appVersion: "1.2.3",
      migration: expect.stringMatching(/^\d{4}_/),
      settings: { missingAfterDays: 7 },
    });
    expect(JSON.parse(bundle["db/host.json"])).not.toHaveProperty(
      "healthchecksUrl",
    );
    expect(JSON.parse(bundle["db/summary.json"])).not.toHaveProperty(
      "latestRaw",
    );
    expect(JSON.parse(bundle["db/disk.json"]).latestRaw).toMatchObject({
      serial_number: expect.any(String),
    });
  });

  it("cuts readings off at 30 days", async () => {
    ingestMars();
    const id = sdbId();
    ingest(
      "smartctl-xall",
      readFixture(SDB),
      { device: "/dev/sdb", type: "auto" },
      new Date("2026-08-01T00:00:00Z"),
    );
    expect(
      db.select().from(smartReading).where(eq(smartReading.diskId, id)).all(),
    ).toHaveLength(2);

    const bundle = await buildDiskDiagnostics(id, { now: NOW });
    const readings = JSON.parse(bundle["db/smart-readings.json"]);
    expect(readings).toHaveLength(1);
    expect(readings[0].takenAt).toBe(T0.toISOString());
  });

  it("gives an inventory-only disk the db view alone", async () => {
    const { id } = db.insert(disk).values({ serial: "INV1" }).returning().get();
    const bundle = await buildDiskDiagnostics(id, { now: NOW });

    expect(Object.keys(bundle).some((path) => path.startsWith("raw/"))).toBe(
      false,
    );
    expect(bundle).not.toHaveProperty("db/host.json");
    expect(bundle["README.md"]).toContain("never been seen by a collector");
  });

  it("rejects an unknown disk", async () => {
    await expect(buildDiskDiagnostics(999_999)).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it("replays into a fresh database to the same disk", async () => {
    ingestMars();
    const before = comparable(await getDisk(sdbId(), NOW));
    const directory = writeBundle(await buildDiskDiagnostics(sdbId()));

    flushDb();
    replayBundle(directory);

    expect(comparable(await getDisk(sdbId(), NOW))).toEqual(before);
  });
});

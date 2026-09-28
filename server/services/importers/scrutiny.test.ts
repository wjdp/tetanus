import { and, count, eq } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "~~/server/database/client";
import {
  diaryEntry,
  disk,
  diskKey,
  smartAttribute,
  smartReading,
  temperatureReading,
} from "~~/server/database/schema";
import { listDiary } from "~~/server/services/diary";
import { type DiskRow, observeDisk } from "~~/server/services/disks";
import { upsertHostByName } from "~~/server/services/hosts";
import {
  type ImportScrutinyOptions,
  importScrutiny,
  type ScrutinyDeviceImport,
} from "~~/server/services/importers/scrutiny";
import {
  ATA_KEY,
  NVME_KEY,
  SCRUTINY_TEST_URL,
  scrutinyFixtureFetch,
  UNMATCHED_KEY,
} from "~~/server/services/importers/scrutinyFixtureFetch";
import { recordIngest } from "~~/server/services/ingest";
import { flushDb } from "~~/test/db";
import { readFixture } from "~~/test/fixtures";

const t0 = new Date("2026-09-10T12:00:00Z");
const ATA_SERIAL = "1AQLP5ME";
const NVME_SERIAL = "453939583131";

let hostId: number;

function ingestSmart(fixture: string, device: string) {
  const outcome = recordIngest({
    hostName: "mars",
    source: "smartctl-xall",
    meta: { device, type: device.includes("nvme") ? "nvme" : "sat" },
    body: readFixture(`mars/smartctl/${fixture}`),
    receivedAt: t0,
  });
  expect(outcome.ok).toBe(true);
}

function seedMars() {
  ingestSmart("xall-sdb-auto.json", "/dev/sdb");
  ingestSmart("xall-nvme0.json", "/dev/nvme0");
}

function diskBySerial(serial: string): DiskRow {
  return db.select().from(disk).where(eq(disk.serial, serial)).get() as DiskRow;
}

function run(overrides: Partial<ImportScrutinyOptions> = {}) {
  return importScrutiny({
    url: SCRUTINY_TEST_URL,
    hostId,
    dryRun: false,
    fetchImpl: scrutinyFixtureFetch(),
    ...overrides,
  });
}

function byKey(devices: ScrutinyDeviceImport[]) {
  return Object.fromEntries(devices.map((device) => [device.key, device]));
}

function readingsOf(diskId: number) {
  return db
    .select()
    .from(smartReading)
    .where(eq(smartReading.diskId, diskId))
    .orderBy(smartReading.takenAt)
    .all();
}

function countRows(table: SQLiteTable) {
  return db.select({ rows: count() }).from(table).get()?.rows;
}

function rowCounts() {
  return Object.fromEntries(
    Object.entries({
      disk,
      diskKey,
      smartReading,
      smartAttribute,
      temperatureReading,
      diaryEntry,
    }).map(([name, table]) => [name, countRows(table)]),
  );
}

beforeEach(() => {
  flushDb();
  hostId = upsertHostByName("mars", t0).id;
});

describe("importScrutiny matching", () => {
  it("matches the ATA disk by wwn and the NVMe disk by model and serial", async () => {
    seedMars();
    const devices = byKey((await run()).devices);

    expect(devices[ATA_KEY]).toMatchObject({
      matched: "wwn",
      diskId: diskBySerial(ATA_SERIAL).id,
      model: "WDC WD120EMAZ-11BLFA0",
      serial: ATA_SERIAL,
    });
    expect(devices[NVME_KEY]).toMatchObject({
      matched: "serial",
      diskId: diskBySerial(NVME_SERIAL).id,
    });
  });

  it("matches on model and serial columns ignoring case and repeated spaces", async () => {
    const row = observeDisk({
      hostId,
      receivedAt: t0,
      keys: [{ kind: "by-id", value: "ata-something" }],
      identity: { model: "wdc   wd120emaz-11blfa0", serial: "1aqlp5me" },
    }) as DiskRow;

    const devices = byKey((await run()).devices);

    expect(devices[ATA_KEY]).toMatchObject({
      matched: "serial",
      diskId: row.id,
    });
  });

  it("creates an inventory-only disk for an unmatched device", async () => {
    seedMars();
    const devices = byKey((await run()).devices);

    const created = devices[UNMATCHED_KEY];
    expect(created).toMatchObject({ matched: "created", cutoff: null });
    const row = db
      .select()
      .from(disk)
      .where(eq(disk.id, created.diskId as number))
      .get();
    expect(row).toMatchObject({
      model: "ST16000NM001G-2KK103",
      serial: "PH8Y0FJQ",
      protocol: "ata",
      capacityBytes: 16000900661248,
      rotationRate: 7200,
      transport: null,
      firstSeenAt: new Date("2024-03-19T10:58:18.156Z"),
      lastSeenAt: new Date("2025-05-22T00:00:12.580Z"),
      lastSeenHostId: hostId,
      lastDevicePath: "/dev/sdi",
      latestStatus: "unknown",
      latestReadingAt: null,
    });
    expect(
      db
        .select()
        .from(diskKey)
        .where(eq(diskKey.diskId, row?.id as number))
        .all(),
    ).toEqual([
      expect.objectContaining({ kind: "wwn", value: "5000c50bd5ec0ece" }),
    ]);
    expect(created.readings).toBe(1);
  });

  it("records the import in each written disk's diary", async () => {
    seedMars();
    const devices = byKey((await run()).devices);

    for (const key of [ATA_KEY, NVME_KEY, UNMATCHED_KEY]) {
      const [entry] = listDiary({
        subjectType: "disk",
        subjectId: devices[key].diskId as number,
      }).filter((diary) => diary.eventType === "imported-from-scrutiny");
      expect(entry.data).toMatchObject({
        key,
        matched: devices[key].matched,
        readings: devices[key].readings,
        temperatures: devices[key].temperatures,
      });
    }
  });
});

describe("importScrutiny readings", () => {
  it("imports only points before the disk's first tetanus data", async () => {
    seedMars();
    const ata = diskBySerial(ATA_SERIAL);
    const collected = readingsOf(ata.id);
    const earliestTemperature = db
      .select({ at: temperatureReading.at })
      .from(temperatureReading)
      .where(eq(temperatureReading.diskId, ata.id))
      .orderBy(temperatureReading.at)
      .limit(1)
      .get()?.at as Date;
    expect(earliestTemperature < t0).toBe(true);

    const devices = byKey((await run()).devices);

    expect(devices[ATA_KEY]).toMatchObject({
      cutoff: earliestTemperature,
      readings: 3,
      skipped: 2,
    });
    const imported = readingsOf(ata.id).filter(
      (reading) => reading.source === "scrutiny",
    );
    expect(imported.map((reading) => reading.takenAt)).toEqual([
      new Date("2021-01-06T00:00:00Z"),
      new Date("2025-01-01T00:00:00Z"),
      new Date("2026-08-31T00:00:00Z"),
    ]);
    expect(readingsOf(ata.id).filter((r) => r.source === "collector")).toEqual(
      collected,
    );
    expect(devices[NVME_KEY]).toMatchObject({ readings: 2, skipped: 3 });
  });

  it("marks imported readings and keeps Disk.latest fields", async () => {
    seedMars();
    const before = diskBySerial(ATA_SERIAL);

    await run();

    const [oldest] = readingsOf(before.id);
    expect(oldest).toMatchObject({
      source: "scrutiny",
      hostId,
      devicePath: "/dev/sdb",
      deviceType: "sat",
      smartPassed: null,
      exitStatus: null,
      temp: 39,
      powerOnHours: 146,
      powerCycles: 46,
    });
    const after = diskBySerial(ATA_SERIAL);
    expect(after.latestReadingAt).toEqual(before.latestReadingAt);
    expect(after.latestStatus).toBe(before.latestStatus);
    expect(after.latestRaw).toBe(before.latestRaw);
  });

  it("evaluates imported attributes with our policy, not scrutiny's", async () => {
    seedMars();
    await run();
    const ata = diskBySerial(ATA_SERIAL);

    const reading = readingsOf(ata.id).find(
      (row) => row.takenAt.getTime() === Date.parse("2026-08-31T00:00:00Z"),
    ) as typeof smartReading.$inferSelect;
    const pending = db
      .select()
      .from(smartAttribute)
      .where(
        and(
          eq(smartAttribute.readingId, reading.id),
          eq(smartAttribute.attrId, "197"),
        ),
      )
      .get();

    expect(pending).toMatchObject({
      name: "Current Pending Sector Count",
      rawValue: 16,
      transformedValue: 16,
      status: "failed",
    });
    expect(pending?.failureRate).toBeGreaterThan(0.1);
    expect(reading.deviceStatus).toBe("failed");
    const nvme = readingsOf(diskBySerial(NVME_SERIAL).id);
    expect(
      nvme
        .filter((row) => row.source === "scrutiny")
        .map((row) => row.deviceStatus),
    ).toEqual(["passed", "passed"]);
  });

  it("writes each temperature time once across sources and runs", async () => {
    seedMars();
    const overlapping = JSON.stringify({
      success: true,
      data: {
        temp_history: {
          [ATA_KEY]: [
            { date: "2021-01-06T00:00:00Z", temp: 30 },
            { date: "2021-01-06T00:00:00Z", temp: 31 },
            { date: "2021-01-05T21:00:00Z", temp: 39 },
          ],
        },
      },
    });
    const fetchImpl = () =>
      scrutinyFixtureFetch({ "/api/summary/temp": overlapping });

    const first = byKey((await run({ fetchImpl: fetchImpl() })).devices);
    const second = byKey((await run({ fetchImpl: fetchImpl() })).devices);

    const ata = diskBySerial(ATA_SERIAL);
    const early = db
      .select()
      .from(temperatureReading)
      .where(
        and(
          eq(temperatureReading.diskId, ata.id),
          eq(temperatureReading.at, new Date("2021-01-06T00:00:00Z")),
        ),
      )
      .all();
    expect(early).toHaveLength(1);
    expect(first[ATA_KEY].temperatures).toBe(4);
    expect(second[ATA_KEY]).toMatchObject({ readings: 0, temperatures: 0 });
  });
});

describe("importScrutiny runs", () => {
  it("writes nothing in a dry run and previews the same counts", async () => {
    seedMars();
    const before = rowCounts();

    const preview = await run({ dryRun: true });

    expect(rowCounts()).toEqual(before);
    expect(preview.dryRun).toBe(true);
    const imported = await run();
    expect(
      preview.devices.map(({ diskId: _diskId, ...device }) => device),
    ).toEqual(imported.devices.map(({ diskId: _diskId, ...device }) => device));
    expect(byKey(preview.devices)[UNMATCHED_KEY].diskId).toBeNull();
  });

  it("records and skips a device whose details call fails", async () => {
    seedMars();
    const fetchImpl = scrutinyFixtureFetch({
      [`/api/device/${UNMATCHED_KEY}/details`]: new Response("boom", {
        status: 500,
      }),
    });

    const devices = byKey((await run({ fetchImpl })).devices);

    expect(devices[UNMATCHED_KEY]).toMatchObject({
      diskId: null,
      readings: 0,
      error: expect.stringContaining("500"),
    });
    expect(devices[ATA_KEY].readings).toBe(3);
    expect(countRows(disk)).toBe(2);
  });

  it("reports progress per device", async () => {
    const progress: [number, number][] = [];
    await run({ onProgress: (done, total) => progress.push([done, total]) });
    expect(progress).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
  });

  it("fails with a 502 when scrutiny is unreachable", async () => {
    const fetchImpl = scrutinyFixtureFetch({
      "/api/summary": new Response("gone", { status: 503 }),
    });
    await expect(run({ fetchImpl })).rejects.toMatchObject({ statusCode: 502 });
  });

  it("rejects an unknown host", async () => {
    await expect(run({ hostId: hostId + 100 })).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});

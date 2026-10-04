import { join } from "node:path";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "~~/server/database/client";
import { diaryEntry, disk, diskKey } from "~~/server/database/schema";
import { getDisk } from "~~/server/services/disks";
import { recordIngest } from "~~/server/services/ingest";
import { flushDb } from "~~/test/db";
import { replayBundle } from "~~/test/diagnostics";
import { readFixture } from "~~/test/fixtures";

const BUNDLE = join(import.meta.dirname, "../../test/fixtures/bugs/usb-bridge");
const RAW = "bugs/usb-bridge/raw/usbhost";
const DRIVE_SERIAL = "ZE-JDK2D5KZ6A25";
const runAt = new Date("2026-10-04T18:00:47Z");
const MINUTE_MS = 60 * 1000;

function ingest(
  source: string,
  file: string,
  receivedAt: Date,
  meta: Record<string, string> = {},
) {
  const outcome = recordIngest({
    hostName: "usbhost",
    source,
    meta,
    body: readFixture(`${RAW}/${file}`),
    receivedAt,
  });
  expect(outcome.ok).toBe(true);
}

const ingestLsblk = (at: Date) => ingest("lsblk", "lsblk.json", at);
const ingestUdev = (at: Date) =>
  ingest("udev", "udev/b8-0.txt", at, { device: "b8:0" });
const ingestSmartctl = (at: Date) =>
  ingest("smartctl-xall", "smartctl/xall-sda.json", at, {
    device: "/dev/sda",
  });

function disksAtSda() {
  return db
    .select()
    .from(disk)
    .where(eq(disk.lastDevicePath, "/dev/sda"))
    .all();
}

function bridgedDisk() {
  const [row] = disksAtSda();
  return row;
}

describe("USB bridge bundle", () => {
  beforeEach(() => {
    flushDb();
  });

  it("keeps one disk with the drive's identity and the bridge's usage", async () => {
    replayBundle(BUNDLE);

    expect(db.select().from(disk).all()).toHaveLength(2);
    expect(disksAtSda()).toHaveLength(1);
    const summary = await getDisk(bridgedDisk().id, new Date(runAt));
    expect(summary).toMatchObject({
      serial: DRIVE_SERIAL,
      link: "usb",
      state: "in-use",
      usage: {
        kind: "filesystem",
        mounts: [{ fsType: "ext4", path: "/srv/backup", via: [] }],
      },
    });
    expect(summary.keys).toEqual(
      expect.arrayContaining([
        { kind: "model-serial", value: "EFRX-68N32N0|WH5552TQ8A19" },
        { kind: "model-serial", value: "WDC_WD40EFRX-68N|ZE-JDK2D5KZ6A25" },
        { kind: "by-id", value: "usb-WDC_WD40_EFRX-68N32N0_93N6QK5700FQ-0:0" },
      ]),
    );
    expect(summary.keys.map((key) => key.value).join(" ")).not.toContain(
      "5000000000000001",
    );
  });

  it("drops the twin's appearance and records the link", () => {
    replayBundle(BUNDLE);

    const diary = db
      .select()
      .from(diaryEntry)
      .where(eq(diaryEntry.subjectId, bridgedDisk().id))
      .all()
      .map((entry) => entry.eventType);
    expect(diary.filter((type) => type === "disk-appeared")).toHaveLength(1);
    expect(diary).toContain("bridge-linked");
  });

  it("matches the bridge's keys directly on the next run", () => {
    replayBundle(BUNDLE);
    const id = bridgedDisk().id;
    const nextRun = new Date(runAt.getTime() + 10 * MINUTE_MS);

    ingestLsblk(nextRun);
    ingestUdev(nextRun);

    expect(disksAtSda().map((row) => row.id)).toEqual([id]);
  });

  it("links when smartctl arrives first, on the next run", () => {
    ingestSmartctl(runAt);
    ingestLsblk(runAt);
    expect(disksAtSda()).toHaveLength(2);

    ingestSmartctl(new Date(runAt.getTime() + 10 * MINUTE_MS));

    expect(disksAtSda()).toHaveLength(1);
    expect(bridgedDisk().serial).toBe(DRIVE_SERIAL);
  });

  it("leaves a bridge disk last seen outside the collector run", () => {
    ingestLsblk(runAt);
    ingestSmartctl(new Date(runAt.getTime() + 60 * MINUTE_MS));

    expect(disksAtSda()).toHaveLength(2);
  });

  it("leaves a bridge disk the user has annotated", () => {
    ingestLsblk(runAt);
    db.update(disk)
      .set({ notes: "in the grey enclosure" })
      .where(eq(disk.lastDevicePath, "/dev/sda"))
      .run();
    ingestSmartctl(runAt);

    expect(disksAtSda()).toHaveLength(2);
  });

  it("leaves a bridge disk of a different size", () => {
    ingestLsblk(runAt);
    db.update(disk)
      .set({ capacityBytes: 2_000_398_934_016 })
      .where(eq(disk.lastDevicePath, "/dev/sda"))
      .run();
    ingestSmartctl(runAt);

    expect(disksAtSda()).toHaveLength(2);
    expect(db.select().from(diskKey).all().length).toBeGreaterThan(0);
  });
});

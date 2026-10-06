import { readdirSync } from "node:fs";
import { join } from "node:path";
import { and, eq, inArray } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { UNKNOWN_USAGE } from "#shared/usage";
import { db } from "~~/server/database/client";
import {
  collectorRun,
  diaryEntry,
  disk,
  diskKey,
  fault,
  host,
  pool,
  smartAttribute,
  vdev,
} from "~~/server/database/schema";
import { parse as parseSmartctl } from "~~/server/ingest/smartctl-xall";
import { acceptFault } from "~~/server/services/acceptance";
import { listDiary } from "~~/server/services/diary";
import {
  type DiskRow,
  findDiskByAlias,
  findDiskByKey,
  getDisk,
  inferState,
  listDisks,
  observeDisk,
  observeDiskFromSmartctl,
  updateDisk,
} from "~~/server/services/disks";
import { DRIVE_DB_SNAPSHOT } from "~~/server/services/drive-db/lookup";
import { updateHost, upsertHostByName } from "~~/server/services/hosts";
import { recordIngest } from "~~/server/services/ingest";
import { updateSettings } from "~~/server/services/settings";
import { reapplySmartPolicy } from "~~/server/services/smartPolicy";
import { archivePool } from "~~/server/services/zfs";
import { flushDb } from "~~/test/db";
import { replayBundle } from "~~/test/diagnostics";
import { readFixture } from "~~/test/fixtures";

const seenAt = new Date("2026-09-01T10:00:00Z");
const UDEV_DIR = join(import.meta.dirname, "../../test/fixtures/mars/udev");
const udevFixtures = readdirSync(UDEV_DIR)
  .filter((name) => name.endsWith(".txt"))
  .map((name) => name.replace(/\.txt$/, ""));

function ingest(
  source: string,
  body: string,
  device?: string,
  hostName = "mars",
  receivedAt = seenAt,
) {
  const outcome = recordIngest({
    hostName,
    source,
    meta: device ? { device } : {},
    body,
    receivedAt,
  });
  expect(outcome.ok).toBe(true);
}

function ingestLsblk(hostName = "mars", receivedAt = seenAt) {
  ingest(
    "lsblk",
    readFixture("mars/lsblk.json"),
    undefined,
    hostName,
    receivedAt,
  );
}

function ingestUdev() {
  for (const name of udevFixtures) {
    ingest(
      "udev",
      readFixture(`mars/udev/${name}.txt`),
      name.slice(1).replace("-", ":"),
    );
  }
}

function ingestVdevIdConf() {
  ingest("vdev-id-conf", readFixture("mars/vdev-id-conf.txt"));
}

function ingestMars() {
  ingestLsblk();
  ingestUdev();
  ingestVdevIdConf();
}

function observeSmartctl(name: string, hostId: number, receivedAt = seenAt) {
  const parsed = parseSmartctl(
    readFixture(`mars/smartctl/${name}.json`),
    {},
  ).data;
  return observeDiskFromSmartctl(hostId, { type: "sat" }, parsed, receivedAt);
}

function diskBySerial(serial: string): DiskRow {
  return db.select().from(disk).where(eq(disk.serial, serial)).get() as DiskRow;
}

function eventsOf(diskId: number, eventType: string) {
  return listDiary({ subjectType: "disk", subjectId: diskId }).filter(
    (entry) => entry.eventType === eventType,
  );
}

function snapshot() {
  return {
    disks: db.select().from(disk).orderBy(disk.id).all(),
    keys: db.select().from(diskKey).orderBy(diskKey.id).all(),
    diary: db.select().from(diaryEntry).orderBy(diaryEntry.id).all(),
  };
}

function putInPool(diskId: number, present = true) {
  const mars = upsertHostByName("mars", seenAt);
  const tank = db
    .insert(pool)
    .values({
      hostId: mars.id,
      guid: "1",
      name: "tank",
      state: "ONLINE",
      firstSeenAt: seenAt,
      lastSeenAt: seenAt,
    })
    .returning()
    .get();
  const mirror = db
    .insert(vdev)
    .values({
      poolId: tank.id,
      guid: "2",
      name: "mirror-0",
      type: "mirror",
      state: "ONLINE",
      lastSeenAt: seenAt,
    })
    .returning()
    .get();
  db.insert(vdev)
    .values({
      poolId: tank.id,
      guid: "3",
      parentId: mirror.id,
      name: "K1",
      type: "disk",
      state: "DEGRADED",
      diskId,
      present,
      lastSeenAt: seenAt,
    })
    .run();
  return tank.id;
}

function lsblkWithout(serial: string) {
  const json = JSON.parse(readFixture("mars/lsblk.json"));
  json.blockdevices = json.blockdevices.filter(
    (device: { serial: string | null }) => device.serial !== serial,
  );
  return JSON.stringify(json);
}

describe("observing mars", () => {
  beforeEach(() => {
    flushDb();
  });

  it("creates one disk per lsblk whole disk with a serial", () => {
    ingestLsblk();
    const disks = db.select().from(disk).all();
    expect(disks).toHaveLength(20);
    expect(diskBySerial("0UTY8HTE")).toMatchObject({
      model: "WDC WD120EMAZ-11",
      link: "sas",
      lastDevicePath: "/dev/sda",
      firstSeenAt: seenAt,
      lastSeenAt: seenAt,
    });
  });

  it("records disk-appeared once, when a sighting creates the disk", () => {
    ingestLsblk();
    ingestLsblk("mars", new Date("2026-09-01T11:00:00Z"));
    const sda = diskBySerial("0UTY8HTE");
    expect(eventsOf(sda.id, "disk-appeared")).toEqual([
      expect.objectContaining({
        title: "appeared on mars",
        at: seenAt,
        data: { hostId: sda.lastSeenHostId, devicePath: "/dev/sda" },
      }),
    ]);
  });

  it("merges udev into the lsblk disks and takes aliases from by-vdev", () => {
    ingestMars();
    expect(db.select().from(disk).all()).toHaveLength(20);
    expect(findDiskByAlias("K2")?.serial).toBe("1AQLP5ME");
    expect(findDiskByKey("by-id", "wwn-0x5000ccad5ed6ee0c")?.alias).toBe("K2");
    expect(findDiskByKey("udev-serial", "35000ccad5ed6ee0c")?.alias).toBe("K2");
    expect(findDiskByKey("wwn", "0x5000CCAD5ED6EE0C")?.alias).toBe("K2");
  });

  it("resolves vdev_id.conf targets, including scsi-SATA_ names", () => {
    ingestMars();
    expect(diskBySerial("H8NPAO4SU23238R").alias).toBe("Z1");
    const aliases = db
      .select({ alias: disk.alias })
      .from(disk)
      .all()
      .map((row) => row.alias)
      .filter((alias) => alias !== null)
      .sort();
    expect(aliases).toEqual(
      "K1 K2 K3 K4 K5 K6 L1 L2 L4 M1 M2 M3 Q1 Q3 Q4 Z1 Z3 Z4 Z5".split(" "),
    );
    expect(eventsOf(diskBySerial("H8NPAO4SU23238R").id, "alias-set")).toEqual([
      expect.objectContaining({ title: "alias Z1 from vdev-id-conf" }),
    ]);
  });

  it("is idempotent", () => {
    ingestMars();
    const first = snapshot();
    ingestMars();
    expect(snapshot()).toEqual(first);
  });

  it("merges smartctl, keeping its full model over lsblk's truncated one", () => {
    const mars = upsertHostByName("mars", seenAt);
    ingestLsblk();
    const observed = observeSmartctl("xall-sda-auto", mars.id);
    ingestLsblk();
    expect(observed?.id).toBe(diskBySerial("0UTY8HTE").id);
    expect(diskBySerial("0UTY8HTE")).toMatchObject({
      model: "WDC WD120EMAZ-11BLFA0",
      modelFamily: expect.any(String),
      protocol: "ata",
      lastDeviceType: "sat",
      scrutinyUuid: "42e3857b-e3a9-534c-b5a6-3a1c7ace3160",
    });
  });

  it("returns null for observations without keys", () => {
    const mars = upsertHostByName("mars", seenAt);
    expect(
      observeDisk({ hostId: mars.id, receivedAt: seenAt, keys: [] }),
    ).toBeNull();
  });

  it("records a conflict once on the older disk without merging", () => {
    const mars = upsertHostByName("mars", seenAt);
    const older = observeDisk({
      hostId: mars.id,
      receivedAt: seenAt,
      keys: [{ kind: "wwn", value: "aa" }],
    })!;
    const newer = observeDisk({
      hostId: mars.id,
      receivedAt: seenAt,
      keys: [{ kind: "wwn", value: "bb" }],
    })!;
    const both = [
      { kind: "wwn" as const, value: "aa" },
      { kind: "wwn" as const, value: "bb" },
      { kind: "by-id" as const, value: "new" },
    ];

    const first = observeDisk({
      hostId: mars.id,
      receivedAt: seenAt,
      keys: both,
    });
    observeDisk({ hostId: mars.id, receivedAt: seenAt, keys: both });

    expect(first?.id).toBe(older.id);
    expect(eventsOf(older.id, "identity-conflict")).toEqual([
      expect.objectContaining({
        data: expect.objectContaining({ diskIds: [older.id, newer.id] }),
      }),
    ]);
    expect(findDiskByKey("by-id", "new")).toBeUndefined();
  });

  it("records a move to another host", () => {
    ingestLsblk("mars", seenAt);
    const later = new Date("2026-09-03T10:00:00Z");
    ingestLsblk("venus", later);
    const sda = diskBySerial("0UTY8HTE");
    expect(eventsOf(sda.id, "moved-host")).toEqual([
      expect.objectContaining({ title: "moved from mars to venus", at: later }),
    ]);
    ingestLsblk("venus", later);
    expect(eventsOf(sda.id, "moved-host")).toHaveLength(1);
  });

  it("does not move a disk back for an older sighting", () => {
    ingestLsblk("venus", new Date("2026-09-03T10:00:00Z"));
    ingestLsblk("mars", seenAt);
    const sda = diskBySerial("0UTY8HTE");
    expect(eventsOf(sda.id, "moved-host")).toEqual([]);
    expect(sda.firstSeenAt).toEqual(seenAt);
  });

  it("records alias drift once per seen alias without overwriting", () => {
    ingestMars();
    const k2 = findDiskByAlias("K2")!;
    const drifted = readFixture("mars/vdev-id-conf.txt").replace(
      /alias\tK2\t/,
      "alias\tK9\t",
    );
    ingest("vdev-id-conf", drifted);
    ingest("vdev-id-conf", drifted);
    expect(findDiskByAlias("K2")?.id).toBe(k2.id);
    expect(eventsOf(k2.id, "alias-drift")).toEqual([
      expect.objectContaining({
        data: expect.objectContaining({ alias: "K9", stored: "K2" }),
      }),
    ]);
  });
});

describe("inferState", () => {
  const now = new Date("2026-09-10T10:00:00Z");
  const context = {
    inPool: false,
    present: false,
    mounted: false,
    now,
    missingAfterDays: 7,
  };

  it("is unseen when never seen", () => {
    expect(inferState({ lastSeenAt: null }, context)).toBe("unseen");
  });

  it("is in-use when present in a pool", () => {
    expect(
      inferState(
        { lastSeenAt: now },
        { ...context, present: true, inPool: true },
      ),
    ).toBe("in-use");
  });

  it("is in-use when present and mounted", () => {
    expect(
      inferState(
        { lastSeenAt: now },
        { ...context, present: true, mounted: true },
      ),
    ).toBe("in-use");
  });

  it("is spare when present outside a pool", () => {
    expect(inferState({ lastSeenAt: now }, { ...context, present: true })).toBe(
      "spare",
    );
  });

  it("is missing when absent for up to N days", () => {
    expect(
      inferState(
        { lastSeenAt: new Date("2026-09-03T10:00:00Z") },
        { ...context, inPool: true },
      ),
    ).toBe("missing");
  });

  it("is removed when absent for longer than N days", () => {
    expect(
      inferState({ lastSeenAt: new Date("2026-09-03T09:59:59Z") }, context),
    ).toBe("removed");
  });
});

describe("disk state, overrides and inventory", () => {
  let sdaId: number;

  beforeEach(() => {
    flushDb();
    ingestMars();
    sdaId = diskBySerial("0UTY8HTE").id;
  });

  it("reports pool membership from the present vdev", async () => {
    const poolId = putInPool(sdaId);
    const membership = {
      poolId,
      poolName: "tank",
      poolPath: "/zfs/mars/tank",
      poolArchived: false,
      vdevName: "K1",
      groupName: "mirror-0",
      groupType: "mirror",
      vdevState: "DEGRADED",
    };
    const disks = await listDisks(new Date("2026-09-01T11:00:00Z"));
    expect(disks.find((row) => row.id === sdaId)?.membership).toEqual(
      membership,
    );
    expect(
      disks.filter((row) => row.id !== sdaId).map((row) => row.membership),
    ).toEqual(Array(19).fill(null));
    expect((await getDisk(sdaId)).membership).toEqual(membership);
  });

  it("marks membership of an archived pool", async () => {
    archivePool(putInPool(sdaId));
    expect((await getDisk(sdaId)).membership).toMatchObject({
      poolName: "tank",
      poolArchived: true,
    });
  });

  it("has no membership for a vdev that left the pool", async () => {
    putInPool(sdaId, false);
    expect((await getDisk(sdaId)).membership).toBeNull();
  });

  it("lists disks with keys, host and computed state", async () => {
    const disks = await listDisks(new Date("2026-09-01T11:00:00Z"));
    expect(disks).toHaveLength(20);
    expect(disks[0].alias).toBe("K1");
    const sda = disks.find((row) => row.id === sdaId)!;
    expect(sda).toMatchObject({
      state: "spare",
      inferredState: "spare",
      lastState: "spare",
      hostName: "mars",
      ageDays: null,
      warrantyDaysLeft: null,
    });
    expect(sda.keys).toContainEqual({ kind: "wwn", value: "5000cca5f853b4e6" });
    expect(sda).not.toHaveProperty("latestRaw");
  });

  it("reports presence as of the host's last scan", async () => {
    const soon = await listDisks(new Date("2026-09-01T11:00:00Z"));
    expect(soon.find((row) => row.id === sdaId)?.present).toBe(true);
    const silent = await listDisks(new Date("2026-09-01T13:00:00Z"));
    expect(silent.every((row) => row.present)).toBe(true);
    ingest(
      "lsblk",
      lsblkWithout("0UTY8HTE"),
      undefined,
      "mars",
      new Date("2026-09-01T13:00:00Z"),
    );
    const rescanned = await listDisks(new Date("2026-09-01T13:00:00Z"));
    expect(rescanned.find((row) => row.id === sdaId)?.present).toBe(false);
  });

  it("resolves the short model from inventory, drive-db line, then model", async () => {
    db.update(disk)
      .set({ model: "WDC WD120EMAZ-11BLFA0", specs: null })
      .where(eq(disk.id, sdaId))
      .run();
    expect((await getDisk(sdaId)).modelShort).toBe("WD120EMAZ");

    const specs = (await getDisk(sdaId)).specs;
    db.update(disk)
      .set({ specs: { ...specs, line: "WD Red Plus" } as DiskRow["specs"] })
      .where(eq(disk.id, sdaId))
      .run();
    expect((await getDisk(sdaId)).modelShort).toBe("WD Red Plus");

    await updateDisk(sdaId, { inventory: { modelShort: "Shucked 12" } });
    expect((await getDisk(sdaId)).modelShort).toBe("Shucked 12");
  });

  it("serves the vendor override as the vendor and keeps what was detected", async () => {
    const detected = (await getDisk(sdaId)).vendor;
    expect((await getDisk(sdaId)).detectedVendor).toBe(detected);

    const overridden = await updateDisk(sdaId, {
      inventory: { vendorOverride: "toshiba" },
    });
    expect(overridden).toMatchObject({
      vendor: "toshiba",
      detectedVendor: detected,
    });
    expect(db.select().from(disk).where(eq(disk.id, sdaId)).get()?.vendor).toBe(
      detected,
    );

    const cleared = await updateDisk(sdaId, {
      inventory: { vendorOverride: null },
    });
    expect(cleared.vendor).toBe(detected);
  });

  it("resolves temperature thresholds from the last host and media", async () => {
    db.update(disk).set({ media: "hdd" }).where(eq(disk.id, sdaId)).run();
    expect((await getDisk(sdaId)).tempThresholds).toEqual({
      warning: 45,
      error: 55,
    });

    const { lastSeenHostId } = await getDisk(sdaId);
    updateHost(lastSeenHostId!, {
      temperatureThresholds: { ssd: { warning: 65, error: 75 } },
    });
    expect((await getDisk(sdaId)).tempThresholds).toEqual({
      warning: 45,
      error: 55,
    });

    db.update(disk).set({ media: "ssd" }).where(eq(disk.id, sdaId)).run();
    expect((await getDisk(sdaId)).tempThresholds).toEqual({
      warning: 65,
      error: 75,
    });
  });

  it("records state transitions on read", async () => {
    putInPool(sdaId);
    expect((await getDisk(sdaId, new Date("2026-09-01T11:00:00Z"))).state).toBe(
      "in-use",
    );
    expect(eventsOf(sdaId, "state-changed")).toEqual([]);

    ingest(
      "lsblk",
      lsblkWithout("0UTY8HTE"),
      undefined,
      "mars",
      new Date("2026-09-01T13:00:00Z"),
    );
    const missing = await getDisk(sdaId, new Date("2026-09-01T13:00:00Z"));
    expect(missing.state).toBe("missing");
    await getDisk(sdaId, new Date("2026-09-01T14:00:00Z"));
    expect(eventsOf(sdaId, "state-changed")).toEqual([
      expect.objectContaining({ title: "missing (was in-use)" }),
    ]);

    ingest(
      "lsblk",
      lsblkWithout("0UTY8HTE"),
      undefined,
      "mars",
      new Date("2026-09-09T11:00:00Z"),
    );
    await listDisks(new Date("2026-09-09T11:00:00Z"));
    expect(eventsOf(sdaId, "state-changed")[0].title).toBe(
      "removed (was missing)",
    );
  });

  it("applies and clears a state override", async () => {
    const now = new Date("2026-09-01T11:00:00Z");
    await getDisk(sdaId, now);
    const dead = await updateDisk(sdaId, { stateOverride: "dead" }, now);
    expect(dead).toMatchObject({
      state: "dead",
      inferredState: "spare",
      stateOverride: "dead",
    });
    const cleared = await updateDisk(sdaId, { stateOverride: null }, now);
    expect(cleared.state).toBe("spare");
    expect(eventsOf(sdaId, "override-set").map((entry) => entry.title)).toEqual(
      ["state override cleared (now spare)", "state set to dead"],
    );
    expect(eventsOf(sdaId, "state-changed")).toEqual([]);
  });

  it("merges inventory and computes age and warranty", async () => {
    const now = new Date("2026-09-01T11:00:00Z");
    await updateDisk(
      sdaId,
      { inventory: { purchaseDate: "2025-09-01", supplier: "eBay" } },
      now,
    );
    const updated = await updateDisk(
      sdaId,
      {
        inventory: { supplier: null, warrantyExpiry: "2026-09-11" },
        notes: "shucked",
      },
      now,
    );
    expect(updated).toMatchObject({
      inventory: { purchaseDate: "2025-09-01", warrantyExpiry: "2026-09-11" },
      notes: "shucked",
      ageDays: 365,
      warrantyDaysLeft: 10,
    });
    expect(updated.inventory).not.toHaveProperty("supplier");
  });

  it("counts the warranty down to whichever expiry ends later", async () => {
    const now = new Date("2026-09-01T00:00:00Z");
    const updated = await updateDisk(
      sdaId,
      {
        inventory: {
          warrantyExpiry: "2026-09-11",
          sellerWarrantyExpiry: "2026-10-01",
        },
      },
      now,
    );
    expect(updated.warrantyDaysLeft).toBe(30);
  });

  it("writes a moved-storage entry when the storage location changes", async () => {
    const at = new Date("2026-09-01T00:00:00Z");
    const store = (storageLocation: string | null) =>
      updateDisk(sdaId, { inventory: { storageLocation } }, at);
    await store("drawer");
    await store("drawer");
    await store("offsite");
    await store(null);
    await updateDisk(sdaId, { inventory: { supplier: "Scan" } }, at);
    expect(
      eventsOf(sdaId, "moved-storage").map((entry) => entry.title),
    ).toEqual([
      "no longer stored at offsite",
      "moved from drawer to offsite",
      "stored at drawer",
    ]);
  });

  it("sets, clears and refuses clashing aliases", async () => {
    await expect(updateDisk(sdaId, { alias: "K2" })).rejects.toMatchObject({
      statusCode: 409,
    });
    expect((await updateDisk(sdaId, { alias: null })).alias).toBeNull();
    expect((await updateDisk(sdaId, { alias: "X1" })).alias).toBe("X1");
  });

  it("counts diary entries and includes keys on the detail", async () => {
    const id = findDiskByAlias("K2")!.id;
    const detail = await getDisk(id);
    expect(detail.diaryCount).toBe(
      listDiary({ subjectType: "disk", subjectId: id }).length,
    );
    expect(detail.diaryCount).toBeGreaterThan(0);
    expect(detail.keys.length).toBeGreaterThan(2);
  });

  it("404s for a missing disk", async () => {
    await expect(getDisk(99999)).rejects.toMatchObject({ statusCode: 404 });
    await expect(updateDisk(99999, {})).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});

describe("disk disposal", () => {
  const absentAt = new Date("2026-09-01T13:00:00Z");
  const rma = { kind: "rma", on: "2026-09-01" } as const;
  let sdaId: number;
  let k2Id: number;

  beforeEach(() => {
    flushDb();
    ingestMars();
    sdaId = diskBySerial("0UTY8HTE").id;
    k2Id = findDiskByAlias("K2")!.id;
    ingest("lsblk", lsblkWithout("0UTY8HTE"), undefined, "mars", absentAt);
  });

  function titlesOf(diskId: number, eventType: string) {
    return eventsOf(diskId, eventType).map((entry) => entry.title);
  }

  it("disposes an absent disk and clears it again", async () => {
    const sold = await updateDisk(
      sdaId,
      { disposal: { kind: "sold", on: "2026-09-01", salePrice: 40 } },
      absentAt,
    );
    expect(sold.disposal).toEqual({
      kind: "sold",
      on: "2026-09-01",
      salePrice: 40,
    });
    expect(sold.replacesDiskId).toBeNull();
    const cleared = await updateDisk(sdaId, { disposal: null }, absentAt);
    expect(cleared.disposal).toBeNull();
    expect(titlesOf(sdaId, "disposed")).toEqual([
      "sold for £40.00 on 2026-09-01",
    ]);
    expect(eventsOf(sdaId, "disposal-cleared")).toEqual([
      expect.objectContaining({
        title: "disposal cleared (was sold for £40.00 on 2026-09-01)",
        data: {
          from: { kind: "sold", on: "2026-09-01", salePrice: 40 },
          to: null,
        },
      }),
    ]);
  });

  it("formats the sale price in the display currency", async () => {
    await updateSettings({ config: { currency: "EUR" } });
    await updateDisk(
      sdaId,
      { disposal: { kind: "sold", on: "2026-09-01", salePrice: 40 } },
      absentAt,
    );
    expect(titlesOf(sdaId, "disposed")).toEqual([
      "sold for €40.00 on 2026-09-01",
    ]);
  });

  it("refuses to dispose a present disk, naming its host", async () => {
    await expect(
      updateDisk(k2Id, { disposal: rma }, absentAt),
    ).rejects.toMatchObject({
      statusCode: 409,
      message: "K2 is still attached to mars",
    });
    expect(eventsOf(k2Id, "disposed")).toEqual([]);
  });

  it("lets an existing disposal change while the disk is present again", async () => {
    await updateDisk(sdaId, { disposal: rma }, absentAt);
    ingestLsblk("mars", new Date("2026-09-02T10:00:00Z"));
    const changed = await updateDisk(
      sdaId,
      { disposal: { kind: "recycled", on: "2026-09-02" } },
      new Date("2026-09-02T10:30:00Z"),
    );
    expect(changed).toMatchObject({
      present: true,
      disposal: { kind: "recycled", on: "2026-09-02" },
    });
  });

  it("links a replacement to an RMA'd disk", async () => {
    await updateDisk(sdaId, { disposal: rma }, absentAt);
    const replacement = await updateDisk(
      k2Id,
      { replacesDiskId: sdaId },
      absentAt,
    );
    expect(replacement.replacesDiskId).toBe(sdaId);
    expect((await getDisk(sdaId, absentAt)).replacedByDiskId).toBe(k2Id);
    expect(eventsOf(sdaId, "replaced-by")).toEqual([
      expect.objectContaining({
        title: "replaced by K2",
        data: { diskId: k2Id },
      }),
    ]);
    expect(eventsOf(k2Id, "replaces")).toEqual([
      expect.objectContaining({
        title: `replaces K1`,
        data: { diskId: sdaId },
      }),
    ]);
  });

  it("refuses a replacement of itself, of a disk not RMA'd, or of one already replaced", async () => {
    await expect(
      updateDisk(k2Id, { replacesDiskId: k2Id }, absentAt),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      updateDisk(k2Id, { replacesDiskId: 99999 }, absentAt),
    ).rejects.toMatchObject({ statusCode: 400 });
    await updateDisk(
      sdaId,
      { disposal: { kind: "recycled", on: "2026-09-01" } },
      absentAt,
    );
    await expect(
      updateDisk(k2Id, { replacesDiskId: sdaId }, absentAt),
    ).rejects.toMatchObject({ statusCode: 409 });

    await updateDisk(sdaId, { disposal: rma }, absentAt);
    await updateDisk(k2Id, { replacesDiskId: sdaId }, absentAt);
    const k3Id = findDiskByAlias("K3")!.id;
    await expect(
      updateDisk(k3Id, { replacesDiskId: sdaId }, absentAt),
    ).rejects.toMatchObject({
      statusCode: 409,
      message: `K1 is already replaced by K2`,
    });
  });

  it("writes replacement-cleared on both sides when unlinking or re-pointing", async () => {
    const k3Id = findDiskByAlias("K3")!.id;
    await updateDisk(sdaId, { disposal: rma }, absentAt);
    await updateDisk(k2Id, { replacesDiskId: sdaId }, absentAt);
    await updateDisk(k2Id, { replacesDiskId: null }, absentAt);
    expect(titlesOf(sdaId, "replacement-cleared")).toEqual([
      "no longer replaced by K2",
    ]);
    expect(titlesOf(k2Id, "replacement-cleared")).toEqual([
      "no longer replaces K1",
    ]);

    await updateDisk(k3Id, { replacesDiskId: sdaId }, absentAt);
    db.update(disk).set({ disposal: rma }).where(eq(disk.id, k2Id)).run();
    await updateDisk(k3Id, { replacesDiskId: k2Id }, absentAt);
    expect(titlesOf(sdaId, "replacement-cleared")).toHaveLength(2);
    expect(titlesOf(k3Id, "replacement-cleared")).toEqual([
      "no longer replaces K1",
    ]);
    expect(titlesOf(k2Id, "replaced-by")).toEqual(["replaced by K3"]);
  });

  it.each([
    ["clearing", null],
    ["changing away from rma", { kind: "recycled", on: "2026-09-01" } as const],
  ])(
    "%s a replaced RMA disposal nulls the replacement's link",
    async (_, disposal) => {
      await updateDisk(sdaId, { disposal: rma }, absentAt);
      await updateDisk(k2Id, { replacesDiskId: sdaId }, absentAt);
      await updateDisk(sdaId, { disposal }, absentAt);
      expect((await getDisk(k2Id, absentAt)).replacesDiskId).toBeNull();
      expect(titlesOf(sdaId, "replacement-cleared")).toEqual([
        "no longer replaced by K2",
      ]);
      expect(titlesOf(k2Id, "replacement-cleared")).toEqual([
        "no longer replaces K1",
      ]);
    },
  );

  it("keeps the link when an RMA disposal is re-saved as rma", async () => {
    await updateDisk(sdaId, { disposal: rma }, absentAt);
    await updateDisk(k2Id, { replacesDiskId: sdaId }, absentAt);
    await updateDisk(
      sdaId,
      { disposal: { kind: "rma", on: "2026-08-31" } },
      absentAt,
    );
    expect((await getDisk(k2Id, absentAt)).replacesDiskId).toBe(sdaId);
    expect(eventsOf(sdaId, "replacement-cleared")).toEqual([]);
  });

  it("freezes state transitions while disposed", async () => {
    await getDisk(sdaId, absentAt);
    await updateDisk(sdaId, { disposal: rma }, absentAt);
    const later = new Date("2026-09-20T11:00:00Z");
    ingest("lsblk", lsblkWithout("0UTY8HTE"), undefined, "mars", later);
    const aged = (await listDisks(later)).find((row) => row.id === sdaId)!;
    expect(aged.state).toBe("removed");
    expect(eventsOf(sdaId, "state-changed")).toEqual([]);
  });

  it("records a disposed disk seen again once per disposal", async () => {
    const disposedAt = new Date("2026-09-01T14:00:00Z");
    await updateDisk(sdaId, { disposal: rma }, disposedAt);
    ingestLsblk("mars", new Date("2026-09-02T10:00:00Z"));
    ingestLsblk("mars", new Date("2026-09-02T11:00:00Z"));
    expect(eventsOf(sdaId, "disposed-disk-seen")).toEqual([
      expect.objectContaining({
        title: "seen on mars while RMA'd on 2026-09-01",
        data: { hostId: expect.any(Number), disposalOn: "2026-09-01" },
      }),
    ]);
    const detail = await getDisk(sdaId);
    expect(detail.disposal).toEqual(rma);
    expect(detail.seenSinceDisposal).toEqual({
      at: new Date("2026-09-02T10:00:00Z"),
      title: "seen on mars while RMA'd on 2026-09-01",
    });

    await updateDisk(
      sdaId,
      { disposal: rma },
      new Date("2026-09-02T12:00:00Z"),
    );
    expect((await getDisk(sdaId)).seenSinceDisposal).toBeNull();
    ingestLsblk("mars", new Date("2026-09-02T13:00:00Z"));
    ingestLsblk("mars", new Date("2026-09-02T14:00:00Z"));
    expect(eventsOf(sdaId, "disposed-disk-seen")).toHaveLength(2);
  });

  it("ignores sightings from before the disposal", async () => {
    const disposedAt = new Date("2026-09-01T14:00:00Z");
    await updateDisk(sdaId, { disposal: rma }, disposedAt);
    ingestLsblk("mars", new Date("2026-09-01T12:00:00Z"));
    expect(eventsOf(sdaId, "disposed-disk-seen")).toEqual([]);
  });
});

type LsblkNode = Record<string, unknown>;

function syntheticLsblk(patches: Record<string, LsblkNode> = {}) {
  const json = JSON.parse(readFixture("synthetic-lsblk/lvm-on-luks.json"));
  json.blockdevices = json.blockdevices.map((device: LsblkNode) => ({
    ...device,
    ...patches[device.name as string],
  }));
  return JSON.stringify(json);
}

const wiped = { fstype: null, mountpoints: [null] };
const zfsLabel = { fstype: "zfs_member", mountpoints: [null] };

describe("disk usage", () => {
  const later = new Date("2026-09-01T11:00:00Z");

  beforeEach(() => {
    flushDb();
  });

  function ingestSynthetic(
    patches: Record<string, LsblkNode> = {},
    receivedAt = seenAt,
  ) {
    ingest("lsblk", syntheticLsblk(patches), undefined, "mars", receivedAt);
  }

  function usageEvents(serial: string) {
    return eventsOf(diskBySerial(serial).id, "usage-changed");
  }

  it("persists the latest usage without an event on first sight", () => {
    ingestSynthetic();
    expect(diskBySerial("WD-WCC7K1234567").latestUsage).toEqual({
      kind: "filesystem",
      fsTypes: ["ext4"],
      mounts: [{ fsType: "ext4", path: "/srv", via: [] }],
      system: false,
    });
    expect(usageEvents("WD-WCC7K1234567")).toEqual([]);
  });

  it("records a kind change", () => {
    ingestSynthetic();
    ingestSynthetic({ sda: wiped }, later);
    ingestSynthetic({ sda: zfsLabel }, new Date("2026-09-01T12:00:00Z"));
    expect(diskBySerial("WD-WCC7K1234567").latestUsage?.kind).toBe("zfs");
    expect(usageEvents("WD-WCC7K1234567")).toEqual([
      expect.objectContaining({
        title: "zfs label",
        data: { from: "empty", to: "zfs", fsTypes: ["zfs_member"] },
      }),
      expect.objectContaining({
        title: "wiped",
        at: later,
        data: { from: "filesystem", to: "empty", fsTypes: [] },
      }),
    ]);
  });

  it("titles formatting and joining a pool", () => {
    ingestSynthetic({ sda: wiped });
    ingestSynthetic({}, later);
    putInPool(diskBySerial("WD-WCC7K1234567").id);
    ingestSynthetic({ sda: zfsLabel }, new Date("2026-09-01T12:00:00Z"));
    expect(usageEvents("WD-WCC7K1234567").map((entry) => entry.title)).toEqual([
      "joined pool tank",
      "formatted ext4",
    ]);
  });

  it("stays quiet when either side is unknown", () => {
    ingestSynthetic();
    ingestSynthetic(
      { sdc: { children: [{ ...sdcPartition(), mountpoints: ["/media"] }] } },
      later,
    );
    expect(diskBySerial("WL1ABCDE").latestUsage?.kind).toBe("filesystem");
    expect(usageEvents("WL1ABCDE")).toEqual([]);
  });

  it("ignores an older sighting", () => {
    ingestSynthetic({}, later);
    ingestSynthetic({ sda: wiped });
    expect(diskBySerial("WD-WCC7K1234567").latestUsage?.kind).toBe(
      "filesystem",
    );
  });

  it("marks mounted disks in use and infers the system purpose", async () => {
    ingestSynthetic();
    const disks = await listDisks(later);
    const nvme = disks.find((row) => row.serial === "S4EVNX0R123456A")!;
    const sda = disks.find((row) => row.serial === "WD-WCC7K1234567")!;
    const sdc = disks.find((row) => row.serial === "WL1ABCDE")!;
    expect(nvme).toMatchObject({
      state: "in-use",
      usage: { kind: "filesystem", system: true },
      purpose: "system",
      purposeInferred: true,
    });
    expect(nvme).not.toHaveProperty("latestUsage");
    expect(sda).toMatchObject({
      state: "in-use",
      purpose: null,
      purposeInferred: false,
    });
    expect(sdc).toMatchObject({ state: "spare", usage: { kind: "unknown" } });
  });

  it("assumes a zfs disk is pooled on a host too old to report pools", async () => {
    ingestSynthetic({ sda: zfsLabel });
    const sdaOf = async () =>
      (await listDisks(later)).find((row) => row.serial === "WD-WCC7K1234567");
    expect(await sdaOf()).toMatchObject({ state: "spare", poolsKnown: true });

    db.update(host)
      .set({ toolVersions: { zfs: "zfs-2.2.2-0ubuntu9.1" } })
      .where(eq(host.name, "mars"))
      .run();

    expect(await sdaOf()).toMatchObject({
      state: "in-use",
      poolsKnown: false,
    });
  });

  it("keeps an unmounted filesystem spare", async () => {
    ingestSynthetic({ sda: { mountpoints: [null] } });
    const disks = await listDisks(later);
    expect(disks.find((row) => row.serial === "WD-WCC7K1234567")).toMatchObject(
      { state: "spare", usage: { kind: "filesystem" } },
    );
  });

  it("prefers the inventory purpose over the inferred one", async () => {
    ingestSynthetic();
    const nvmeId = diskBySerial("S4EVNX0R123456A").id;
    const updated = await updateDisk(
      nvmeId,
      { inventory: { purpose: "system" } },
      later,
    );
    expect(updated).toMatchObject({
      purpose: "system",
      purposeInferred: false,
    });
  });

  it("reports zfs usage for pool members whatever the labels say", async () => {
    ingestSynthetic();
    const sdcId = diskBySerial("WL1ABCDE").id;
    putInPool(sdcId);
    expect((await getDisk(sdcId, later)).usage.kind).toBe("zfs");
  });

  it("is unknown before any lsblk", async () => {
    const mars = upsertHostByName("mars", seenAt);
    const row = observeDisk({
      hostId: mars.id,
      receivedAt: seenAt,
      keys: [{ kind: "wwn", value: "aa" }],
    })!;
    expect((await getDisk(row.id, later)).usage).toEqual(UNKNOWN_USAGE);
  });
});

function sdcPartition(): LsblkNode {
  const json = JSON.parse(readFixture("synthetic-lsblk/lvm-on-luks.json"));
  const sdc = json.blockdevices.find(
    (device: LsblkNode) => device.name === "sdc",
  );
  return sdc.children[0];
}

describe("hardware classification", () => {
  beforeEach(() => {
    flushDb();
  });

  const SMARTCTL_DIR = join(
    import.meta.dirname,
    "../../test/fixtures/mars/smartctl",
  );
  const marsSmartctlFixtures = readdirSync(SMARTCTL_DIR)
    .filter((name) => name.endsWith("-auto.json") || name === "xall-nvme0.json")
    .map((name) => name.replace(/\.json$/, ""));

  function ingestMarsSmartctl() {
    for (const name of marsSmartctlFixtures) {
      const device = `/dev/${name.replace(/^xall-/, "").replace(/-auto$/, "")}`;
      const outcome = recordIngest({
        hostName: "mars",
        source: "smartctl-xall",
        meta: { device },
        body: readFixture(`mars/smartctl/${name}.json`),
        receivedAt: seenAt,
      });
      expect(outcome.ok).toBe(true);
    }
  }

  function interfaceCounts() {
    const counts: Record<string, number> = {};
    for (const row of db.select().from(disk).all()) {
      const key = `${row.interface}/${row.link}`;
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  }

  it("classifies every mars disk by interface and link", () => {
    ingestLsblk();
    ingestMarsSmartctl();
    expect(interfaceCounts()).toEqual({
      "sata/sas": 15,
      "sata/sata": 4,
      "nvme/nvme": 1,
    });
  });

  function countBy(key: (row: DiskRow) => string) {
    const counts: Record<string, number> = {};
    for (const row of db.select().from(disk).all()) {
      counts[key(row)] = (counts[key(row)] ?? 0) + 1;
    }
    return counts;
  }

  it("resolves vendor, specs and recording tech for every mars disk", () => {
    ingestLsblk();
    ingestMarsSmartctl();
    expect(countBy((row) => `${row.media}/${row.vendor}`)).toEqual({
      "hdd/western-digital": 5,
      "hdd/seagate": 6,
      "hdd/toshiba": 1,
      "ssd/samsung": 5,
      "ssd/intel": 2,
      "ssd/western-digital": 1,
    });
    expect(countBy((row) => `${row.media}/${row.recordingTech}`)).toEqual({
      "hdd/cmr": 12,
      "ssd/null": 8,
    });
    expect(countBy((row) => String(row.specs?.source))).toEqual({
      local: 13,
      nasdisks: 7,
    });
    const rows = db.select().from(disk).all();
    expect(rows.flatMap((row) => row.hardware?.specMismatch ?? [])).toEqual([]);
    expect(
      rows.filter((row) => row.hardware?.recordingTechInferred),
    ).toHaveLength(0);
  });

  it("stores the dataset spec with its source and snapshot", () => {
    const mars = upsertHostByName("mars", seenAt);
    const sdf = observeSmartctl("xall-sdf-auto", mars.id);
    expect(sdf?.specs).toMatchObject({
      source: "nasdisks",
      snapshot: DRIVE_DB_SNAPSHOT,
      matchedModel: "ST12000NM000J",
      recordingTech: "cmr",
    });
  });

  it("stores null specs for a model the dataset misses", () => {
    const mars = upsertHostByName("mars", seenAt);
    const parsed = parseSmartctl(
      readFixture("mars/smartctl/xall-sdf-auto.json"),
      {},
    ).data;
    parsed.identity.model = "ST99999NM999Z-2TY103";
    const unknown = observeDiskFromSmartctl(mars.id, {}, parsed, seenAt);
    expect(unknown).toMatchObject({
      specs: null,
      vendor: "seagate",
      recordingTech: "unknown",
    });
  });

  it("fills the NVMe form factor from the dataset", () => {
    const mars = upsertHostByName("mars", seenAt);
    const nvme = observeSmartctl("xall-nvme0", mars.id);
    expect(nvme).toMatchObject({ formFactor: "M.2", media: "ssd" });
    expect(nvme?.hardware?.specMismatch).toBeUndefined();
  });

  it("records a spec mismatch without losing observed hardware", async () => {
    const mars = upsertHostByName("mars", seenAt);
    const parsed = parseSmartctl(
      readFixture("mars/smartctl/xall-sda-auto.json"),
      {},
    ).data;
    parsed.identity.rotationRate = 7200;
    const sda = observeDiskFromSmartctl(mars.id, {}, parsed, seenAt) as DiskRow;
    expect(sda).toMatchObject({
      rotationRate: 7200,
      hardware: {
        sataVersion: "SATA 3.2",
        specMismatch: ["rotationRate: observed 7200, dataset 5400"],
      },
    });

    const patched = await updateDisk(sda.id, {
      inventory: { recordingTech: "smr" },
    });
    expect(patched.hardware?.specMismatch).toEqual([
      "rotationRate: observed 7200, dataset 5400",
    ]);

    const agreed = observeSmartctl("xall-sda-auto", mars.id);
    expect(agreed?.hardware?.specMismatch).toBeUndefined();
    expect(agreed).toMatchObject({
      recordingTech: "smr",
      hardware: { sataVersion: "SATA 3.2" },
    });
  });

  it("detects the vendor from the WWN when the model is blank", () => {
    const mars = upsertHostByName("mars", seenAt);
    const parsed = parseSmartctl(
      readFixture("mars/smartctl/xall-sdf-auto.json"),
      {},
    ).data;
    parsed.identity.model = undefined;
    parsed.identity.modelFamily = undefined;
    const sdf = observeDiskFromSmartctl(mars.id, {}, parsed, seenAt);
    expect(sdf).toMatchObject({ vendor: "seagate", specs: null });
  });

  it("classifies a SATA hdd behind the SAS HBA", () => {
    ingestLsblk();
    const mars = upsertHostByName("mars", seenAt);
    observeSmartctl("xall-sda-auto", mars.id);
    expect(diskBySerial("0UTY8HTE")).toMatchObject({
      media: "hdd",
      interface: "sata",
      link: "sas",
      recordingTech: "cmr",
      logicalBlockSize: 512,
      physicalBlockSize: 4096,
      trimSupported: false,
      hardware: {
        sataVersion: "SATA 3.2",
        ataVersion: "ACS-2, ATA8-ACS T13/1699-D revision 4",
        deviceType: "sat",
        linkSpeed: { maxBps: 6_000_000_000, currentBps: 6_000_000_000 },
      },
    });
  });

  it("reads CMR from the model family", () => {
    const mars = upsertHostByName("mars", seenAt);
    const sdd = observeSmartctl("xall-sdd-auto", mars.id);
    expect(sdd).toMatchObject({
      modelFamily: "Western Digital Red (CMR)",
      recordingTech: "cmr",
    });
    expect(sdd?.hardware?.recordingTechInferred).toBeUndefined();
  });

  it("classifies the NVMe drive as an ssd", () => {
    ingestLsblk();
    const mars = upsertHostByName("mars", seenAt);
    const nvme = observeSmartctl("xall-nvme0", mars.id);
    expect(nvme).toMatchObject({
      media: "ssd",
      interface: "nvme",
      link: "nvme",
      recordingTech: null,
      hardware: { nvmeVersion: "1.3", deviceType: "nvme" },
    });
  });

  it("classifies a SAS drive", () => {
    const mars = upsertHostByName("mars", seenAt);
    const parsed = parseSmartctl(
      readFixture("synthetic-smartctl/xall-sas.json"),
      {},
    ).data;
    const sas = observeDiskFromSmartctl(mars.id, {}, parsed, seenAt);
    expect(sas).toMatchObject({
      protocol: "scsi",
      media: "hdd",
      interface: "sas",
      hardware: { scsiTransport: "SAS (SPL-4)", deviceType: "scsi" },
    });
  });

  it("classifies from lsblk before any SMART arrives", () => {
    ingestLsblk();
    expect(diskBySerial("0UTY8HTE")).toMatchObject({
      media: "hdd",
      interface: "unknown",
      link: "sas",
    });
    expect(diskBySerial("M8FWOL2V199566H")).toMatchObject({
      media: "ssd",
      interface: "sata",
      link: "sata",
    });
  });

  it("fills sector sizes from lsblk and lets smartctl overwrite them", () => {
    ingest(
      "lsblk",
      syntheticLsblk({ sda: { "log-sec": 512, "phy-sec": 512 } }),
    );
    expect(diskBySerial("WD-WCC7K1234567")).toMatchObject({
      logicalBlockSize: 512,
      physicalBlockSize: 512,
    });
    const mars = upsertHostByName("mars", seenAt);
    observeSmartctl("xall-sda-auto", mars.id);
    ingest(
      "lsblk",
      syntheticLsblk({
        sda: { serial: "0UTY8HTE", "log-sec": 512, "phy-sec": 512 },
      }),
      undefined,
      "mars",
      new Date("2026-09-01T11:00:00Z"),
    );
    expect(diskBySerial("0UTY8HTE")).toMatchObject({
      logicalBlockSize: 512,
      physicalBlockSize: 4096,
    });
  });

  it("marks a zoned block device as SMR from lsblk alone", () => {
    ingest("lsblk", syntheticLsblk({ sda: { zoned: "host-managed" } }));
    expect(diskBySerial("WD-WCC7K1234567")).toMatchObject({
      media: "hdd",
      recordingTech: "smr",
      hardware: { zoned: "host-managed" },
    });
  });

  it("recomputes recording tech when the inventory override changes", async () => {
    const mars = upsertHostByName("mars", seenAt);
    const sda = observeSmartctl("xall-sda-auto", mars.id) as DiskRow;
    expect(sda.recordingTech).toBe("cmr");

    const overridden = await updateDisk(sda.id, {
      inventory: { recordingTech: "smr" },
    });
    expect(overridden.recordingTech).toBe("smr");

    const cleared = await updateDisk(sda.id, {
      inventory: { recordingTech: null },
    });
    expect(cleared.recordingTech).toBe("cmr");
  });

  it("infers SMR from TRIM on an hdd and flags it inferred", () => {
    const mars = upsertHostByName("mars", seenAt);
    const parsed = parseSmartctl(
      readFixture("mars/smartctl/xall-sde-auto.json"),
      {},
    ).data;
    parsed.identity.trimSupported = true;
    parsed.identity.model = "WDC WD999ZZZZ-11B1HA0";
    const sde = observeDiskFromSmartctl(mars.id, {}, parsed, seenAt);
    expect(sde).toMatchObject({ recordingTech: "smr", trimSupported: true });
    expect(sde?.hardware?.recordingTechInferred).toBe(true);
  });
});

describe("Pi SD card bundle", () => {
  const BUNDLE = join(
    import.meta.dirname,
    "../../test/fixtures/bugs/pi-sd-card",
  );

  it("attaches the model-less lsblk entry to the udev-seen card", async () => {
    replayBundle(BUNDLE);

    const cards = db
      .select({ diskId: diskKey.diskId })
      .from(diskKey)
      .where(eq(diskKey.value, "0x3c91d0a4"))
      .all();
    expect(new Set(cards.map((row) => row.diskId)).size).toBe(1);
    const card = await getDisk(cards[0].diskId);
    expect(card).toMatchObject({
      serial: "0x3c91d0a4",
      capacityBytes: 15_931_539_456,
      lastDevicePath: "/dev/mmcblk0",
      media: "ssd",
      usage: {
        kind: "filesystem",
        fsTypes: ["ext4", "vfat"],
        system: true,
      },
      purpose: "system",
    });
  });
});

describe.each([
  { kind: "a regular", intermittent: false },
  { kind: "an intermittent", intermittent: true },
])("disk state on $kind host", ({ intermittent }) => {
  const HOUR_MS = 60 * 60 * 1000;
  const DAY_MS = 24 * HOUR_MS;
  const seenAtPlus = (ms: number) => new Date(seenAt.getTime() + ms);
  let sdaId: number;

  const stateOf = async (at: Date) =>
    (await listDisks(at)).find((row) => row.id === sdaId)?.state;

  beforeEach(() => {
    flushDb();
    ingestMars();
    sdaId = diskBySerial("0UTY8HTE").id;
    putInPool(sdaId);
    updateHost(upsertHostByName("mars", seenAt).id, { intermittent });
  });

  it("holds disk state while the host is silent for weeks", async () => {
    expect(await stateOf(seenAtPlus(HOUR_MS))).toBe("in-use");
    const weeksLater = await listDisks(seenAtPlus(30 * DAY_MS));
    expect(weeksLater.find((row) => row.id === sdaId)).toMatchObject({
      state: "in-use",
      present: true,
      stateAsOf: seenAt,
    });
    expect(weeksLater.some((row) => row.state === "missing")).toBe(false);
    expect(eventsOf(sdaId, "state-changed")).toEqual([]);
  });

  it("marks a disk pulled while the host is on as missing", async () => {
    ingest(
      "lsblk",
      lsblkWithout("0UTY8HTE"),
      undefined,
      "mars",
      seenAtPlus(3 * HOUR_MS),
    );
    expect(await stateOf(seenAtPlus(3 * HOUR_MS))).toBe("missing");
    expect(await stateOf(seenAtPlus(30 * DAY_MS))).toBe("missing");
  });

  it("only marks the pulled disk missing", async () => {
    ingest(
      "lsblk",
      lsblkWithout("0UTY8HTE"),
      undefined,
      "mars",
      seenAtPlus(3 * HOUR_MS),
    );
    const missing = (await listDisks(seenAtPlus(3 * HOUR_MS))).filter(
      (row) => row.state === "missing",
    );
    expect(missing.map((row) => row.id)).toEqual([sdaId]);
  });

  it("has no stale hint while the host reports", async () => {
    const row = (await listDisks(seenAtPlus(HOUR_MS))).find(
      (disk) => disk.id === sdaId,
    );
    expect(row?.stateAsOf).toBeNull();
  });

  it("has no stale hint on an overridden state", async () => {
    db.update(disk)
      .set({ stateOverride: "spare" })
      .where(eq(disk.id, sdaId))
      .run();
    const row = (await listDisks(seenAtPlus(30 * DAY_MS))).find(
      (disk) => disk.id === sdaId,
    );
    expect(row?.stateAsOf).toBeNull();
  });

  it("holds state while the host boots and zfs reports before smart", async () => {
    await listDisks(seenAtPlus(HOUR_MS));
    const bootedAt = seenAtPlus(10 * DAY_MS);
    db.insert(collectorRun)
      .values({
        hostId: upsertHostByName("mars", bootedAt).id,
        source: "zpool-status",
        receivedAt: bootedAt,
        ok: true,
        bytes: 10,
      })
      .run();
    expect(await stateOf(seenAtPlus(10 * DAY_MS + 5 * 60_000))).toBe("in-use");
    ingestLsblk("mars", seenAtPlus(10 * DAY_MS + 10 * 60_000));
    expect(await stateOf(seenAtPlus(10 * DAY_MS + 15 * 60_000))).toBe("in-use");
    expect(eventsOf(sdaId, "state-changed")).toEqual([]);
  });

  it("judges the disk by the new host's scans once it moves", async () => {
    ingestLsblk("venus", seenAtPlus(DAY_MS));
    expect(await stateOf(seenAtPlus(DAY_MS + HOUR_MS))).toBe("in-use");
    ingest(
      "lsblk",
      lsblkWithout("0UTY8HTE"),
      undefined,
      "venus",
      seenAtPlus(DAY_MS + 3 * HOUR_MS),
    );
    expect(await stateOf(seenAtPlus(DAY_MS + 3 * HOUR_MS))).toBe("missing");
  });
});

describe("health counters and fault counts", () => {
  const SDB = readFixture("mars/smartctl/xall-sdb-auto.json");
  const SDB_SERIAL = JSON.parse(SDB).serial_number as string;

  beforeEach(() => {
    flushDb();
  });

  async function summaryOf(diskId: number) {
    const summary = (await listDisks(seenAt)).find((row) => row.id === diskId);
    if (!summary) throw new Error(`disk ${diskId} not listed`);
    return summary;
  }

  function insertFault(
    subjectId: number,
    key: string,
    state: (typeof fault.$inferInsert)["state"],
    severity: (typeof fault.$inferInsert)["severity"],
    subjectType: (typeof fault.$inferInsert)["subjectType"] = "disk",
  ) {
    db.insert(fault)
      .values({
        kind: "smart-attribute",
        category: "disk",
        subjectType,
        subjectId,
        key,
        severity,
        openedAt: seenAt,
        lastSeenAt: seenAt,
        resolvedAt: state === "resolved" ? seenAt : null,
        state,
        stateChangedAt: seenAt,
      })
      .run();
  }

  it("follows a policy re-apply and an acceptance without an ingest", async () => {
    ingest("smartctl-xall", SDB, "/dev/sdb");
    const { id } = diskBySerial(SDB_SERIAL);
    expect((await summaryOf(id)).counters.reallocated).toEqual({
      value: 0,
      status: "passed",
    });

    db.update(smartAttribute)
      .set({ rawValue: 400, rawString: "400" })
      .where(and(eq(smartAttribute.diskId, id), eq(smartAttribute.attrId, "5")))
      .run();
    reapplySmartPolicy(seenAt);
    const reapplied = (await summaryOf(id)).counters.reallocated;
    expect(reapplied?.value).toBe(400);
    expect(reapplied?.status).not.toBe("passed");

    acceptFault({ diskId: id, attrId: "5", now: seenAt });
    expect((await summaryOf(id)).counters.reallocated).toEqual({
      value: 400,
      status: "accepted",
    });
  });

  describe("substitute defect counts", () => {
    function withoutAtaAttributes(id: number, attrIds: string[]) {
      db.delete(smartAttribute)
        .where(
          and(
            eq(smartAttribute.diskId, id),
            inArray(smartAttribute.attrId, attrIds),
          ),
        )
        .run();
    }

    function withDeviceStatistics(id: number) {
      db.update(disk)
        .set({
          latestDeviceStatistics: {
            reallocatedSectors: 24,
            pendingErrors: 3,
            reportedUncorrectables: 9,
            normalised: [],
          },
        })
        .where(eq(disk.id, id))
        .run();
    }

    it("counts reallocated and pending from device statistics when the attributes are absent", async () => {
      ingest("smartctl-xall", SDB, "/dev/sdb");
      const { id } = diskBySerial(SDB_SERIAL);
      withoutAtaAttributes(id, ["5", "197"]);
      withDeviceStatistics(id);
      const { counters } = await summaryOf(id);
      expect(counters.reallocated?.value).toBe(24);
      expect(counters.reallocated?.status).not.toBe("passed");
      expect(counters.pending?.value).toBe(3);
      expect(counters.uncorrectable?.value).toBe(18);
    });

    it("prefers the attributes the reading has", async () => {
      ingest("smartctl-xall", SDB, "/dev/sdb");
      const { id } = diskBySerial(SDB_SERIAL);
      withDeviceStatistics(id);
      const { counters } = await summaryOf(id);
      expect(counters.reallocated?.value).toBe(0);
      expect(counters.pending?.value).toBe(16);
    });

    it("substitutes nothing when the latest reading has no attributes", async () => {
      ingest("smartctl-xall", SDB, "/dev/sdb");
      const { id } = diskBySerial(SDB_SERIAL);
      db.delete(smartAttribute).where(eq(smartAttribute.diskId, id)).run();
      withDeviceStatistics(id);
      const { counters } = await summaryOf(id);
      expect(counters.reallocated).toBeNull();
      expect(counters.pending).toBeNull();
    });
  });

  it("reads counters from the newest reading, not the last inserted", async () => {
    const older = JSON.parse(SDB);
    older.ata_smart_attributes.table.find(
      (row: { id: number }) => row.id === 5,
    ).raw = { value: 7, string: "7" };
    ingest("smartctl-xall", SDB, "/dev/sdb");
    ingest(
      "smartctl-xall",
      JSON.stringify(older),
      "/dev/sdb",
      "mars",
      new Date(seenAt.getTime() - 60 * 60 * 1000),
    );
    const { id } = diskBySerial(SDB_SERIAL);
    expect((await summaryOf(id)).counters.reallocated?.value).toBe(0);
  });

  it("has null counters for a disk with no reading", async () => {
    ingestLsblk();
    const [first] = await listDisks(seenAt);
    expect(first.counters).toEqual({
      reallocated: null,
      pending: null,
      uncorrectable: null,
      wearPercent: null,
      bytesWritten: null,
      bytesWrittenInferred: false,
    });
    expect(first.faultCounts).toEqual({
      error: 0,
      warning: 0,
      acknowledged: 0,
    });
  });

  it("counts live disk faults: open by severity, acknowledged of any severity", async () => {
    ingest("smartctl-xall", SDB, "/dev/sdb");
    const { id } = diskBySerial(SDB_SERIAL);
    insertFault(id, "a", "open", "error");
    insertFault(id, "b", "open", "error");
    insertFault(id, "c", "open", "warning");
    insertFault(id, "d", "acknowledged", "warning");
    insertFault(id, "e", "acknowledged", "error");
    insertFault(id, "f", "accepted", "error");
    insertFault(id, "g", "resolved", "error");
    insertFault(id, "h", "open", "error", "pool");

    expect((await summaryOf(id)).faultCounts).toEqual({
      error: 2,
      warning: 1,
      acknowledged: 2,
    });
  });
});

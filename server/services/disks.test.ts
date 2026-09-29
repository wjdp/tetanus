import { readdirSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { UNKNOWN_USAGE } from "#shared/usage";
import { db } from "~~/server/database/client";
import {
  diaryEntry,
  disk,
  diskKey,
  pool,
  vdev,
} from "~~/server/database/schema";
import { parse as parseSmartctl } from "~~/server/ingest/smartctl-xall";
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
import { upsertHostByName } from "~~/server/services/hosts";
import { recordIngest } from "~~/server/services/ingest";
import { flushDb } from "~~/test/db";
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

  it("records state transitions on read", async () => {
    putInPool(sdaId);
    expect((await getDisk(sdaId, new Date("2026-09-01T11:00:00Z"))).state).toBe(
      "in-use",
    );
    expect(eventsOf(sdaId, "state-changed")).toEqual([]);

    const missing = await getDisk(sdaId, new Date("2026-09-01T13:00:00Z"));
    expect(missing.state).toBe("missing");
    await getDisk(sdaId, new Date("2026-09-01T14:00:00Z"));
    expect(eventsOf(sdaId, "state-changed")).toEqual([
      expect.objectContaining({ title: "missing (was in-use)" }),
    ]);

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

  it("sets, clears and refuses clashing aliases", async () => {
    await expect(updateDisk(sdaId, { alias: "K2" })).rejects.toMatchObject({
      statusCode: 409,
    });
    expect((await updateDisk(sdaId, { alias: null })).alias).toBeNull();
    expect((await updateDisk(sdaId, { alias: "X1" })).alias).toBe("X1");
  });

  it("includes diary entries and keys on the detail", async () => {
    const detail = await getDisk(findDiskByAlias("K2")!.id);
    expect(detail.diary.map((entry) => entry.eventType)).toContain("alias-set");
    expect(detail.keys.length).toBeGreaterThan(2);
  });

  it("404s for a missing disk", async () => {
    await expect(getDisk(99999)).rejects.toMatchObject({ statusCode: 404 });
    await expect(updateDisk(99999, {})).rejects.toMatchObject({
      statusCode: 404,
    });
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
      { inventory: { purpose: "other" } },
      later,
    );
    expect(updated).toMatchObject({
      purpose: "other",
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

  it("classifies a SATA hdd behind the SAS HBA", () => {
    ingestLsblk();
    const mars = upsertHostByName("mars", seenAt);
    observeSmartctl("xall-sda-auto", mars.id);
    expect(diskBySerial("0UTY8HTE")).toMatchObject({
      media: "hdd",
      interface: "sata",
      link: "sas",
      recordingTech: "unknown",
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

  it("recomputes recording tech when the inventory override changes", async () => {
    const mars = upsertHostByName("mars", seenAt);
    const sda = observeSmartctl("xall-sda-auto", mars.id) as DiskRow;
    expect(sda.recordingTech).toBe("unknown");

    const overridden = await updateDisk(sda.id, {
      inventory: { recordingTech: "smr" },
    });
    expect(overridden.recordingTech).toBe("smr");

    const cleared = await updateDisk(sda.id, {
      inventory: { recordingTech: null },
    });
    expect(cleared.recordingTech).toBe("unknown");
  });

  it("infers SMR from TRIM on an hdd and flags it inferred", () => {
    const mars = upsertHostByName("mars", seenAt);
    const parsed = parseSmartctl(
      readFixture("mars/smartctl/xall-sde-auto.json"),
      {},
    ).data;
    parsed.identity.trimSupported = true;
    const sde = observeDiskFromSmartctl(mars.id, {}, parsed, seenAt);
    expect(sde).toMatchObject({ recordingTech: "smr", trimSupported: true });
    expect(sde?.hardware?.recordingTechInferred).toBe(true);
  });
});

import { readdirSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "~~/server/database/client";
import { disk, enclosure } from "~~/server/database/schema";
import { patchBays } from "~~/server/services/bays";
import { listDiary } from "~~/server/services/diary";
import { findDiskByAlias, getDisk } from "~~/server/services/disks";
import { upsertHostByName } from "~~/server/services/hosts";
import { recordIngest } from "~~/server/services/ingest";
import { listHostBays } from "~~/server/services/locations";
import { flushDb } from "~~/test/db";
import { readFixture } from "~~/test/fixtures";

const ENCLOSURE_ID = "5001e677a1a113f0";
const K1_PATH = `pci-0000:26:00.0-sas-exp0x${ENCLOSURE_ID}-phy8-lun-0`;
const UDEV_DIR = join(import.meta.dirname, "../../test/fixtures/mars/udev");
const udevFixtures = readdirSync(UDEV_DIR)
  .filter((name) => name.endsWith(".txt"))
  .map((name) => name.replace(/\.txt$/, ""));
const run1 = new Date("2026-10-01T10:00:00Z");
const run2 = new Date("2026-10-01T11:00:00Z");

function ingest(
  source: string,
  body: string,
  receivedAt: Date,
  device?: string,
) {
  const outcome = recordIngest({
    hostName: "mars",
    source,
    meta: device ? { device } : {},
    body,
    receivedAt,
  });
  expect(outcome.ok).toBe(true);
}

function ingestUdev(receivedAt: Date, rewrite = (body: string) => body) {
  for (const name of udevFixtures) {
    ingest(
      "udev",
      rewrite(readFixture(`mars/udev/${name}.txt`)),
      receivedAt,
      name.replace("-", ":"),
    );
  }
}

function ingestEnclosure(receivedAt: Date, rewrite = (body: string) => body) {
  ingest("enclosure", rewrite(readFixture("mars/enclosure.txt")), receivedAt);
}

function location(alias: string) {
  const row = findDiskByAlias(alias);
  return {
    key: row?.lastLocationKey,
    slot: row?.lastSlot,
    idPath: row?.lastIdPath,
  };
}

const bayMoves = (alias: string) =>
  listDiary({ subjectType: "disk", subjectId: findDiskByAlias(alias)?.id })
    .filter((entry) => entry.eventType === "moved-bay")
    .map((entry) => entry.title);

/** Swaps the disks in slots 8 and 9 (K1 and K2), ports and all. */
function swapK1K2Udev(body: string) {
  return body.replace(/phy8-lun|phy9-lun/g, (match) =>
    match === "phy8-lun" ? "phy9-lun" : "phy8-lun",
  );
}
function swapK1K2Enclosure(body: string) {
  return body
    .replace("block/sda/dev\t8:0", "block/sdX/dev\t8:16")
    .replace("block/sdb/dev\t8:16", "block/sda/dev\t8:0")
    .replace("block/sdX/dev\t8:16", "block/sdb/dev\t8:16");
}

describe("disk locations", () => {
  beforeEach(() => flushDb());

  it("keys disks by ID_PATH on hosts that never post enclosures", () => {
    ingestUdev(run1);
    expect(location("K1")).toEqual({
      key: `path:${K1_PATH}`,
      slot: null,
      idPath: K1_PATH,
    });
    expect(location("Z3").key).toBe("path:pci-0000:06:00.1-ata-5");
  });

  it("keys disks in an SES slot by enclosure and slot", () => {
    ingestUdev(run1);
    ingestEnclosure(run1);
    expect(location("K1")).toEqual({
      key: `enc:${ENCLOSURE_ID}:8`,
      slot: { enclosureId: ENCLOSURE_ID, slot: 8, idPath: K1_PATH },
      idPath: K1_PATH,
    });
    expect(location("M3").key).toBe(`enc:${ENCLOSURE_ID}:22`);
    expect(location("Z3").key).toBe("path:pci-0000:06:00.1-ata-5");
    expect(bayMoves("K1")).toEqual([]);
  });

  it("records no move when the same run is re-sent", () => {
    ingestUdev(run1);
    ingestEnclosure(run1);
    ingestUdev(run2);
    ingestEnclosure(run2);
    expect(location("K1").key).toBe(`enc:${ENCLOSURE_ID}:8`);
    expect(bayMoves("K1")).toEqual([]);
  });

  it("records a move between slots, named by label when set", () => {
    ingestUdev(run1);
    ingestEnclosure(run1);
    const hostId = upsertHostByName("mars").id;
    patchBays(hostId, { [`enc:${ENCLOSURE_ID}:8`]: "Bay 1" });

    ingestUdev(run2, swapK1K2Udev);
    ingestEnclosure(run2, swapK1K2Enclosure);

    expect(location("K1").key).toBe(`enc:${ENCLOSURE_ID}:9`);
    expect(location("K2").key).toBe(`enc:${ENCLOSURE_ID}:8`);
    expect(bayMoves("K1")).toEqual(["moved from Bay 1 to RES2SV240 slot 9"]);
    expect(bayMoves("K2")).toEqual(["moved from RES2SV240 slot 9 to Bay 1"]);
  });

  it("keeps the last slot of a disk that has gone", () => {
    ingestUdev(run1);
    ingestEnclosure(run1);
    const withoutK1 = (body: string) =>
      body
        .replace(
          "8:0:0:0/ArrayDevice08/status\tOK",
          "8:0:0:0/ArrayDevice08/status\tnot installed",
        )
        .replace(/^8:0:0:0\/ArrayDevice08\/device.*\n/m, "");
    for (const name of udevFixtures.filter((name) => name !== "b8-0")) {
      ingest(
        "udev",
        readFixture(`mars/udev/${name}.txt`),
        run2,
        name.replace("-", ":"),
      );
    }
    ingestEnclosure(run2, withoutK1);

    expect(location("K1").key).toBe(`enc:${ENCLOSURE_ID}:8`);
    const slot8 = listHostBays(
      upsertHostByName("mars").id,
      run2,
    ).enclosures[0]?.slots.find((slot) => slot.slot === 8);
    expect(slot8).toMatchObject({
      status: "not installed",
      disk: { id: findDiskByAlias("K1")?.id, alias: "K1" },
    });
  });

  it("clears enclosures when the host posts none", () => {
    ingestUdev(run1);
    ingestEnclosure(run1);
    ingest("enclosure", "", run2);
    expect(db.select().from(enclosure).all()).toEqual([]);
  });

  it("names the disk's bay in the disk payload", async () => {
    ingestUdev(run1);
    ingestEnclosure(run1);
    const k1 = findDiskByAlias("K1");
    patchBays(upsertHostByName("mars").id, {
      [`enc:${ENCLOSURE_ID}:8`]: "Bay 1",
    });
    expect((await getDisk(k1?.id as number, run1)).bay).toEqual({
      locationKey: `enc:${ENCLOSURE_ID}:8`,
      label: "Bay 1",
      defaultLabel: "RES2SV240 slot 8",
    });
    const z3 = findDiskByAlias("Z3");
    expect((await getDisk(z3?.id as number, run1)).bay?.defaultLabel).toBe(
      "SATA port 5",
    );
  });
});

describe("host bays", () => {
  beforeEach(() => flushDb());

  it("lists every slot, path locations and orphaned labels", () => {
    ingestUdev(run1);
    ingestEnclosure(run1);
    const hostId = upsertHostByName("mars").id;
    patchBays(hostId, {
      [`enc:${ENCLOSURE_ID}:8`]: "Bay 1",
      "path:pci-0000:99:00.0-ata-1": "Old card",
    });

    const bays = listHostBays(hostId, run1);
    expect(bays.enclosures).toHaveLength(1);
    const [expander] = bays.enclosures;
    expect(expander).toMatchObject({
      enclosureId: ENCLOSURE_ID,
      name: "8:0:0:0",
      model: "RES2SV240",
    });
    expect(expander?.slots).toHaveLength(24);
    expect(expander?.slots[8]).toMatchObject({
      label: "Bay 1",
      defaultLabel: "RES2SV240 slot 8",
      status: "OK",
      disk: { alias: "K1", present: true },
    });
    expect(expander?.slots[0]?.disk).toBeNull();
    expect(bays.paths.map((bay) => bay.defaultLabel)).toEqual(
      expect.arrayContaining(["SATA port 5", "SATA port 6", "NVMe 01:00.0"]),
    );
    expect(bays.orphans).toEqual([
      {
        locationKey: "path:pci-0000:99:00.0-ata-1",
        label: "Old card",
        defaultLabel: "SATA port 1",
      },
    ]);
  });

  it("deletes a label patched to null", () => {
    const hostId = upsertHostByName("mars").id;
    patchBays(hostId, { "path:x": "X" });
    patchBays(hostId, { "path:x": null });
    expect(listHostBays(hostId).orphans).toEqual([]);
  });

  it("refuses an unknown host", () => {
    expect(() => patchBays(999, {})).toThrow("Host 999 not found");
    expect(() => listHostBays(999)).toThrow("Host 999 not found");
  });
});

describe("locations without ID_PATH", () => {
  beforeEach(() => flushDb());

  it("leaves a partition's location alone", () => {
    ingestUdev(run1);
    const k1 = findDiskByAlias("K1");
    db.update(disk)
      .set({ lastIdPath: null })
      .where(eq(disk.id, k1?.id as number))
      .run();
    ingest("udev", readFixture("mars/udev/b8-1.txt"), run2, "b8:1");
    expect(findDiskByAlias("K1")?.lastIdPath).toBeNull();
  });
});

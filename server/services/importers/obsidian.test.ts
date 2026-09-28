import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "~~/server/database/client";
import { diaryEntry, disk, diskKey } from "~~/server/database/schema";
import { listDiary } from "~~/server/services/diary";
import {
  type DiskRow,
  listDisks,
  observeDisk,
  updateDisk,
} from "~~/server/services/disks";
import { upsertHostByName } from "~~/server/services/hosts";
import {
  findDiskBySerial,
  importObsidian,
} from "~~/server/services/importers/obsidian";
import { flushDb } from "~~/test/db";

const seenAt = new Date("2026-09-01T10:00:00Z");

function seeDisk(model: string, serial: string, byId?: string): DiskRow {
  const mars = upsertHostByName("mars", seenAt);
  const row = observeDisk({
    hostId: mars.id,
    receivedAt: seenAt,
    keys: [
      { kind: "model-serial", value: `${model}|${serial}`.toUpperCase() },
      ...(byId ? [{ kind: "by-id" as const, value: byId }] : []),
    ],
    identity: { model, serial },
  });
  if (!row) throw new Error("disk not observed");
  return row;
}

const TABLE = [
  "| Alias | Model | Serial | Capacity | Status | Purchased | 3.3 V pin | Price |",
  "| --- | --- | --- | --- | --- | --- | --- | --- |",
  "| K2 | HGST HUH721212ALE604 | 1AQLP5ME | 12TB | ONLINE | 2022-03-01 | yes | £190 |",
  "| K3 | | 5PGXYZ12 | 12 TB | SPARE | 14/05/2022 | no | |",
  "| H1 | WDC WD40EFRX-68N32N0 | WD-WCC7K1234567 | 4TB | REMOVED | 1 Jun 2018 | x | 120 |",
  "| | | | | | | | |",
  "| | | | 4TB | | | | |",
].join("\n");

beforeEach(() => {
  flushDb();
});

describe("findDiskBySerial", () => {
  it("matches a key ending in the serial at a separator", () => {
    const row = seeDisk("ST4000", "ZC1", "ata-ST4000_ZC1");
    expect(findDiskBySerial("zc1")).toMatchObject({ disk: { id: row.id } });
    expect(findDiskBySerial("C1")).toBeNull();
  });

  it("strips the WD- prefix the model-serial key drops", () => {
    const row = seeDisk("WDC WD40EFRX", "WD-WCC7K1");
    expect(findDiskBySerial("WD-WCC7K1")).toMatchObject({
      disk: { id: row.id },
    });
  });
});

describe("importObsidian", () => {
  it("matches by model and serial, then serial, then alias", async () => {
    const k2 = seeDisk("HGST HUH721212ALE604", "1AQLP5ME");
    const k3 = seeDisk("HGST HUH721212ALE600", "5PGXYZ12", "ata-HGST_5PGXYZ12");
    const h1 = db.insert(disk).values({ alias: "H1" }).returning().get();

    const result = importObsidian({ text: TABLE, dryRun: false });

    expect(result.matched.map(({ row, diskId }) => [row, diskId])).toEqual([
      [1, k2.id],
      [2, k3.id],
      [3, h1.id],
    ]);
    expect(result.created).toEqual([]);
    expect(result.skipped).toEqual([
      { row: 4, reason: "no serial or alias" },
      { row: 5, reason: "no serial or alias" },
    ]);
    expect(result.columns).toMatchObject({
      alias: "Alias",
      serial: "Serial",
      pin33Taped: "3.3 V pin",
      supplier: null,
    });

    const [k2Summary, k3Summary] = (await listDisks(seenAt)).filter((row) =>
      [k2.id, k3.id].includes(row.id),
    );
    expect(k2Summary).toMatchObject({
      alias: "K2",
      stateOverride: null,
      inventory: {
        purchaseDate: "2022-03-01",
        pin33Taped: true,
        purchasePrice: 190,
      },
    });
    expect(k3Summary).toMatchObject({
      alias: "K3",
      stateOverride: "spare",
      inventory: { purchaseDate: "2022-05-14", pin33Taped: false },
    });
    expect(
      listDiary({ subjectType: "disk", subjectId: k2.id }).map(
        (entry) => entry.eventType,
      ),
    ).toEqual(["imported"]);
  });

  it("keeps an existing alias and state override", async () => {
    const k2 = seeDisk("HGST HUH721212ALE604", "1AQLP5ME");
    await updateDisk(k2.id, { alias: "Q9", stateOverride: "retired" });

    const result = importObsidian({
      text: "alias,serial,status\nK2,1AQLP5ME,SPARE\n",
      dryRun: false,
    });

    expect(result.matched).toMatchObject([{ diskId: k2.id, alias: "Q9" }]);
    const row = db.select().from(disk).where(eq(disk.id, k2.id)).get();
    expect(row).toMatchObject({ alias: "Q9", stateOverride: "retired" });
  });

  it("skips an alias match whose serial differs", () => {
    db.insert(disk).values({ alias: "K2", serial: "AAA" }).run();
    const result = importObsidian({
      text: "alias,serial\nK2,BBB\n",
      dryRun: false,
    });
    expect(result.skipped).toMatchObject([{ row: 1 }]);
    expect(result.created).toEqual([]);
  });

  it("creates unseen inventory-only disks for unmatched rows", async () => {
    const result = importObsidian({ text: TABLE, dryRun: false });

    expect(result.created.map(({ row, alias }) => [row, alias])).toEqual([
      [1, "K2"],
      [2, "K3"],
      [3, "H1"],
    ]);
    const disks = await listDisks(seenAt);
    expect(disks.find((row) => row.alias === "K2")).toMatchObject({
      model: "HGST HUH721212ALE604",
      serial: "1AQLP5ME",
      capacityBytes: 12e12,
      firstSeenAt: null,
      lastSeenAt: null,
      state: "unseen",
      keys: [{ kind: "model-serial", value: "HGST_HUH721212AL|1AQLP5ME" }],
    });
    expect(disks.find((row) => row.alias === "K3")).toMatchObject({
      state: "spare",
      keys: [],
    });
    expect(disks.find((row) => row.alias === "H1")).toMatchObject({
      state: "removed",
      inventory: { purchaseDate: "2018-06-01", purchasePrice: 120 },
    });
    expect(db.select().from(diaryEntry).all()).toHaveLength(3);
  });

  it("leaves no rows behind on a dry run", () => {
    const preview = importObsidian({ text: TABLE, dryRun: true });

    expect(preview.dryRun).toBe(true);
    expect(preview.created).toHaveLength(3);
    expect(db.select().from(disk).all()).toEqual([]);
    expect(db.select().from(diskKey).all()).toEqual([]);
    expect(db.select().from(diaryEntry).all()).toEqual([]);
  });

  it("creates nothing and logs nothing on a second import", () => {
    importObsidian({ text: TABLE, dryRun: false });
    const diaryCount = db.select().from(diaryEntry).all().length;

    const second = importObsidian({ text: TABLE, dryRun: false });

    expect(second.created).toEqual([]);
    expect(second.matched).toHaveLength(3);
    expect(second.matched.every((row) => row.changes.length === 0)).toBe(true);
    expect(db.select().from(disk).all()).toHaveLength(3);
    expect(db.select().from(diaryEntry).all()).toHaveLength(diaryCount);
  });

  it("rejects a table without an alias or serial column", () => {
    expect(() =>
      importObsidian({ text: "model,size\nX,4TB\n", dryRun: true }),
    ).toThrow("alias or a serial column");
  });
});

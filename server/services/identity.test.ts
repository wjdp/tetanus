import { describe, expect, it } from "vitest";
import { parse as parseLsblk } from "~~/server/ingest/lsblk";
import { parse as parseSmartctl } from "~~/server/ingest/smartctl-xall";
import { parse as parseUdev } from "~~/server/ingest/udev";
import {
  extractKeys,
  isPlaceholderWwn,
  keysFromVdevTarget,
  matchDisks,
  normaliseModelSerial,
  scrutinyUuid,
} from "~~/server/services/identity";
import { readFixture } from "~~/test/fixtures";

const lsblk = parseLsblk(readFixture("mars/lsblk.json"), {}).data;

function udev(name: string) {
  return parseUdev(readFixture(`mars/udev/${name}.txt`), {
    device: name.slice(1).replace("-", ":"),
  }).data;
}

function smartctl(name: string) {
  return parseSmartctl(readFixture(`mars/smartctl/${name}.json`), {}).data;
}

describe("normaliseModelSerial", () => {
  it("uppercases, collapses separators and strips WD-", () => {
    expect(normaliseModelSerial("WDC  WD80EFAX_x", "WD-abc 123")).toBe(
      "WDC_WD80EFAX_X|ABC_123",
    );
  });

  it("cuts the model to the 16-character INQUIRY width", () => {
    expect(normaliseModelSerial("WDC WD120EMAZ-11BLFA0", "0UTY8HTE")).toBe(
      normaliseModelSerial("WDC WD120EMAZ-11", "0UTY8HTE"),
    );
    expect(normaliseModelSerial("Samsung SSD 850 EVO 500GB", "X")).toBe(
      "SAMSUNG_SSD_850|X",
    );
  });
});

describe("extractKeys", () => {
  it("takes wwn and model-serial from smartctl", () => {
    expect(
      extractKeys({
        source: "smartctl-xall",
        identity: smartctl("xall-sda-auto").identity,
      }),
    ).toEqual([
      { kind: "wwn", value: "5000cca5f853b4e6" },
      { kind: "model-serial", value: "WDC_WD120EMAZ-11|0UTY8HTE" },
    ]);
  });

  it("takes model-serial only from NVMe smartctl without a wwn", () => {
    expect(
      extractKeys({
        source: "smartctl-xall",
        identity: smartctl("xall-nvme0").identity,
      }),
    ).toEqual([
      { kind: "model-serial", value: "WDS250G3X0C-00SJ|453939583131" },
    ]);
  });

  it("takes wwn and model-serial from lsblk whole disks with a serial", () => {
    const sda = lsblk.disks.find((entry) => entry.name === "sda")!;
    expect(extractKeys({ source: "lsblk", disk: sda })).toEqual([
      { kind: "wwn", value: "5000cca5f853b4e6" },
      { kind: "model-serial", value: "WDC_WD120EMAZ-11|0UTY8HTE" },
    ]);
    const zram = lsblk.disks.find((entry) => entry.name === "zram0")!;
    expect(extractKeys({ source: "lsblk", disk: zram })).toEqual([]);
  });

  it("keys a model-less lsblk disk by its serial as udev's ID_SERIAL", () => {
    const [mmc] = parseLsblk(
      readFixture("bugs/pi-sd-card/raw/pihost/lsblk.json"),
      {},
    ).data.disks.filter((entry) => entry.name === "mmcblk0");
    expect(extractKeys({ source: "lsblk", disk: mmc })).toEqual([
      { kind: "udev-serial", value: "0x3c91d0a4" },
    ]);
  });

  it("takes ID_WWN, ID_SERIAL and by-id names from udev", () => {
    expect(extractKeys({ source: "udev", udev: udev("b65-0") })).toEqual([
      { kind: "wwn", value: "5002538bd9338903" },
      {
        kind: "udev-serial",
        value: "Samsung_SSD_850_EVO_500GB_H8NPAO4SU23238R",
      },
      { kind: "by-id", value: "scsi-35002538bd9338903" },
      { kind: "by-id", value: "wwn-0x5002538bd9338903" },
      { kind: "by-id", value: "ata-Samsung_SSD_850_EVO_500GB_H8NPAO4SU23238R" },
    ]);
  });

  it("keeps NVMe eui wwns and ignores partitions", () => {
    expect(
      extractKeys({ source: "udev", udev: udev("b259-0") }),
    ).toContainEqual({
      kind: "wwn",
      value: "eui.66899335a800ec54f6d3ad26f6d1e818",
    });
    expect(extractKeys({ source: "udev", udev: udev("b8-17") })).toEqual([]);
  });

  it("drops a USB bridge's placeholder wwn and the names udev builds from it", () => {
    const bridged = parseUdev(
      readFixture("bugs/usb-bridge/raw/usbhost/udev/b8-0.txt"),
      { device: "8:0" },
    ).data;
    expect(extractKeys({ source: "udev", udev: bridged })).toEqual([
      { kind: "model-serial", value: "EFRX-68N32N0|WH5552TQ8A19" },
      { kind: "by-id", value: "scsi-SWDC_WD40_EFRX-68N32N0_WH5552TQ8A19" },
      { kind: "by-id", value: "usb-WDC_WD40_EFRX-68N32N0_93N6QK5700FQ-0:0" },
    ]);
    const [sda] = parseLsblk(
      readFixture("bugs/usb-bridge/raw/usbhost/lsblk.json"),
      {},
    ).data.disks;
    expect(extractKeys({ source: "lsblk", disk: sda })).toEqual([
      { kind: "model-serial", value: "EFRX-68N32N0|WH5552TQ8A19" },
    ]);
  });

  it("agrees across sources for the same disk", () => {
    const fromSmartctl = extractKeys({
      source: "smartctl-xall",
      identity: smartctl("xall-sdb-auto").identity,
    });
    const fromLsblk = extractKeys({
      source: "lsblk",
      disk: lsblk.disks.find((entry) => entry.name === "sdb")!,
    });
    const fromUdev = extractKeys({ source: "udev", udev: udev("b8-16") });
    expect(fromLsblk).toEqual(fromSmartctl);
    expect(fromUdev).toContainEqual(fromSmartctl[0]);
  });
});

describe("isPlaceholderWwn", () => {
  it.each(["0x5000000000000001", "5000000d238fe6ca", "0000000000000000"])(
    "treats %s as a placeholder",
    (wwn) => expect(isPlaceholderWwn(wwn)).toBe(true),
  );

  it.each(["5000cca5f853b4e6", "50014eef5e68017f", "eui.6479a7d2fb90942d"])(
    "keeps %s",
    (wwn) => expect(isPlaceholderWwn(wwn)).toBe(false),
  );
});

describe("keysFromVdevTarget", () => {
  it("adds a wwn key for wwn- targets", () => {
    expect(keysFromVdevTarget("wwn-0x5000CCA5F853B4E6")).toEqual([
      { kind: "by-id", value: "wwn-0x5000CCA5F853B4E6" },
      { kind: "wwn", value: "5000cca5f853b4e6" },
    ]);
  });

  it("adds a model-serial key for scsi-SATA_ targets", () => {
    expect(
      keysFromVdevTarget(
        "/dev/disk/by-id/scsi-SATA_Samsung_SSD_850_H8NPAO4SU23238R",
      ),
    ).toEqual([
      { kind: "by-id", value: "scsi-SATA_Samsung_SSD_850_H8NPAO4SU23238R" },
      { kind: "model-serial", value: "SAMSUNG_SSD_850|H8NPAO4SU23238R" },
    ]);
  });
});

describe("matchDisks", () => {
  const existing = [
    { diskId: 1, kind: "wwn" as const, value: "aa" },
    { diskId: 1, kind: "by-id" as const, value: "wwn-0xaa" },
    { diskId: 2, kind: "model-serial" as const, value: "M|S" },
  ];

  it("returns null without a match", () => {
    expect(matchDisks([{ kind: "wwn", value: "bb" }], existing)).toBeNull();
  });

  it("matches on any one key", () => {
    expect(
      matchDisks(
        [
          { kind: "wwn", value: "aa" },
          { kind: "udev-serial", value: "new" },
        ],
        existing,
      ),
    ).toEqual({ diskId: 1 });
  });

  it("does not match the same value under another kind", () => {
    expect(matchDisks([{ kind: "by-id", value: "aa" }], existing)).toBeNull();
  });

  it("reports a conflict when keys point at two disks", () => {
    expect(
      matchDisks(
        [
          { kind: "model-serial", value: "M|S" },
          { kind: "wwn", value: "aa" },
        ],
        existing,
      ),
    ).toEqual({ conflict: [1, 2] });
  });
});

describe("scrutinyUuid", () => {
  it("matches scrutiny for a mars disk with a wwn", () => {
    expect(
      scrutinyUuid("WDC WD120EMAZ-11BLFA0", "0UTY8HTE", "5000cca5f853b4e6"),
    ).toBe("42e3857b-e3a9-534c-b5a6-3a1c7ace3160");
  });

  it("matches scrutiny without a wwn", () => {
    expect(scrutinyUuid("WDC WD120EMAZ-11BLFA0", "0UTY8HTE", undefined)).toBe(
      "77c89aa3-f51f-567c-bcef-5bdc0c92eae9",
    );
  });
});

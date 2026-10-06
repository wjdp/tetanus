import { describe, expect, it } from "vitest";
import { parse } from "../../server/ingest/smartctl-xall";
import { readFixture } from "../../test/fixtures";
import { type AtaSsdDisk, ataSsdAttributesFrom } from "./ataSsdAttributes";
import { writtenUnit } from "./writtenBytes";

const MIB = 1024 ** 2;
const SSD: AtaSsdDisk = { media: "ssd", vendor: null, logicalBlockSize: 512 };

function fromFixture(path: string, disk: AtaSsdDisk) {
  return ataSsdAttributesFrom(parse(readFixture(path), {}).data, disk);
}

describe("ataSsdAttributesFrom", () => {
  it("skips Intel's 233 Total_LBAs_Written for wear and reads 241 in 32 MiB units", () => {
    expect(
      fromFixture("mars/smartctl/xall-sdn-auto.json", {
        ...SSD,
        vendor: "intel",
      }),
    ).toEqual({
      wear: "245",
      reserved: ["170", "179", "180"],
      written: { attrId: "241", unitBytes: 32 * MIB, inferred: false },
    });
  });

  it("picks Samsung's Wear_Leveling_Count and infers written from LBAs", () => {
    expect(
      fromFixture("mars/smartctl/xall-sdo-auto.json", {
        ...SSD,
        vendor: "samsung",
      }),
    ).toEqual({
      wear: "177",
      reserved: ["179"],
      written: { attrId: "241", unitBytes: 512, inferred: true },
    });
  });

  it("uses Media_Wearout_Indicator and has no written attribute without 241", () => {
    expect(
      fromFixture("mars/smartctl/xall-sdp-auto.json", {
        ...SSD,
        vendor: "intel",
      }),
    ).toEqual({ wear: "233", written: null, reserved: ["179", "180"] });
  });

  it("is null for an HDD and for NVMe", () => {
    expect(
      fromFixture("mars/smartctl/xall-sdf-auto.json", {
        ...SSD,
        media: "hdd",
      }),
    ).toBeNull();
    expect(fromFixture("mars/smartctl/xall-nvme0.json", SSD)).toBeNull();
  });
});

describe("writtenUnit", () => {
  const context = { vendor: null, logicalBlockSize: 4096 };

  it("reads the unit from the smartctl name suffix", () => {
    expect(writtenUnit("Host_Writes_32MiB", context)).toEqual({
      unitBytes: 32 * MIB,
      inferred: false,
    });
    expect(writtenUnit("Total_Writes_GiB", context)).toEqual({
      unitBytes: 1024 ** 3,
      inferred: false,
    });
    expect(writtenUnit("Lifetime_Writes_GB", context)).toEqual({
      unitBytes: 1000 ** 3,
      inferred: false,
    });
    expect(writtenUnit("Host_Writes_MiB", context)).toEqual({
      unitBytes: MIB,
      inferred: false,
    });
  });

  it("applies vendor rules only to their vendor", () => {
    expect(
      writtenUnit("Total_LBAs_Written", { ...context, vendor: "intel" }),
    ).toEqual({ unitBytes: 32 * MIB, inferred: false });
    expect(
      writtenUnit("Total_LBAs_Written", { ...context, vendor: "samsung" }),
    ).toEqual({ unitBytes: 4096, inferred: true });
  });

  it("falls back to 512-byte LBAs when the block size is unknown", () => {
    expect(
      writtenUnit("Total_LBAs_Written", {
        vendor: null,
        logicalBlockSize: null,
      }),
    ).toEqual({ unitBytes: 512, inferred: true });
  });
});

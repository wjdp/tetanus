import { describe, expect, it } from "vitest";
import { parse } from "../../server/ingest/smartctl-xall";
import { readFixture } from "../../test/fixtures";
import { type AtaSsdDisk, ataSsdAttributesFrom } from "./ataSsdAttributes";
import {
  type CounterAttribute,
  countersFrom,
  NO_COUNTERS,
  NVME_DATA_UNIT_BYTES,
} from "./counters";
import { evaluateReading } from "./evaluate";
import type { AcceptedLevel } from "./status";

const MIB = 1024 ** 2;
const NO_ACCEPTANCES = new Map<string, AcceptedLevel>();

function fixture(path: string) {
  return parse(readFixture(path), {}).data;
}

function countersOfFixture(path: string, disk?: AtaSsdDisk) {
  const parsed = fixture(path);
  const rows = evaluateReading(parsed).attributes;
  const ataSsd = disk ? ataSsdAttributesFrom(parsed, disk) : null;
  return countersFrom(rows, ataSsd, NO_ACCEPTANCES);
}

function row(
  attrId: string,
  transformedValue: number,
  status: CounterAttribute["status"] = "passed",
  value: number | null = 100,
): CounterAttribute {
  return { attrId, value, transformedValue, status };
}

describe("countersFrom on fixtures", () => {
  it("reads ATA HDD reallocated, pending and uncorrectable with no wear", () => {
    expect(countersOfFixture("mars/smartctl/xall-sda-auto.json")).toEqual({
      reallocated: { value: 0, status: "passed" },
      pending: { value: 0, status: "passed" },
      uncorrectable: { value: 0, status: "passed" },
      wearPercent: null,
      bytesWritten: null,
      bytesWrittenInferred: false,
    });
  });

  it("reads Samsung SATA SSD wear from Wear_Leveling_Count and infers written from LBAs", () => {
    const counters = countersOfFixture("mars/smartctl/xall-sdo-auto.json", {
      media: "ssd",
      vendor: "samsung",
      logicalBlockSize: 512,
    });
    expect(counters.wearPercent).toEqual({ value: 3, status: "passed" });
    expect(counters.bytesWritten).toBe(25107638314 * 512);
    expect(counters.bytesWrittenInferred).toBe(true);
  });

  it("reads Intel sdn wear from Percent_Life_Remaining and written in 32 MiB units", () => {
    const counters = countersOfFixture("mars/smartctl/xall-sdn-auto.json", {
      media: "ssd",
      vendor: "intel",
      logicalBlockSize: 512,
    });
    expect(counters.wearPercent).toEqual({ value: 0, status: "passed" });
    expect(counters.bytesWritten).toBe(1327539 * 32 * MIB);
    expect(counters.bytesWrittenInferred).toBe(false);
  });

  it("reads NVMe media errors, percentage used and data units written", () => {
    expect(countersOfFixture("mars/smartctl/xall-nvme0.json")).toEqual({
      reallocated: null,
      pending: null,
      uncorrectable: { value: 0, status: "passed" },
      wearPercent: { value: 0, status: "passed" },
      bytesWritten: 630453820 * NVME_DATA_UNIT_BYTES,
      bytesWrittenInferred: false,
    });
  });

  it("reads SCSI grown defects and summed uncorrected errors", () => {
    expect(countersOfFixture("synthetic-smartctl/xall-sas.json")).toEqual({
      reallocated: { value: 56, status: "failed" },
      pending: null,
      uncorrectable: { value: 0, status: "passed" },
      wearPercent: null,
      bytesWritten: null,
      bytesWrittenInferred: false,
    });
  });
});

describe("countersFrom", () => {
  it("is all null when the reading has no counter attributes", () => {
    expect(countersFrom([], null, NO_ACCEPTANCES)).toEqual(NO_COUNTERS);
    expect(
      countersFrom(
        [row("9", 1000)],
        {
          wear: "177",
          written: { attrId: "241", unitBytes: 512, inferred: true },
        },
        NO_ACCEPTANCES,
      ),
    ).toEqual(NO_COUNTERS);
  });

  it("overlays accepted and acknowledged levels on counts", () => {
    const rows = [row("5", 8, "warning"), row("197", 3, "warning")];
    const acceptances = new Map<string, AcceptedLevel>([
      ["5", { kind: "accept", acceptedValue: 8 }],
      ["197", { kind: "acknowledge", acceptedValue: 3 }],
    ]);
    const counters = countersFrom(rows, null, acceptances);
    expect(counters.reallocated).toEqual({ value: 8, status: "accepted" });
    expect(counters.pending).toEqual({ value: 3, status: "acknowledged" });
  });

  it("drops the overlay once the count rises past the accepted level", () => {
    const acceptances = new Map<string, AcceptedLevel>([
      ["5", { kind: "accept", acceptedValue: 8 }],
    ]);
    expect(
      countersFrom([row("5", 9, "warning")], null, acceptances).reallocated,
    ).toEqual({ value: 9, status: "warning" });
  });

  it("colours SCSI uncorrected errors by the worse of read and write", () => {
    const failedRead = countersFrom(
      [
        row("read_total_uncorrected_errors", 2, "failed"),
        row("write_total_uncorrected_errors", 0),
      ],
      null,
      NO_ACCEPTANCES,
    );
    expect(failedRead.uncorrectable).toEqual({ value: 2, status: "failed" });

    const acknowledgedRead = countersFrom(
      [
        row("read_total_uncorrected_errors", 2, "failed"),
        row("write_total_uncorrected_errors", 1, "failed"),
      ],
      null,
      new Map([
        [
          "read_total_uncorrected_errors",
          { kind: "acknowledge", acceptedValue: 2 },
        ],
      ]),
    );
    expect(acknowledgedRead.uncorrectable).toEqual({
      value: 3,
      status: "failed",
    });
  });

  it("raises NVMe wear to warning at 80 % and failed at 100 %", () => {
    const wear = (percent: number) =>
      countersFrom([row("percentage_used", percent)], null, NO_ACCEPTANCES)
        .wearPercent;
    expect(wear(79)?.status).toBe("passed");
    expect(wear(80)?.status).toBe("warning");
    expect(wear(100)?.status).toBe("failed");
  });

  it("keeps an accepted NVMe wear quiet when the attribute itself failed", () => {
    const counters = countersFrom(
      [row("percentage_used", 101, "failed")],
      null,
      new Map([["percentage_used", { kind: "accept", acceptedValue: 101 }]]),
    );
    expect(counters.wearPercent).toEqual({ value: 101, status: "accepted" });
  });

  it("derives ATA wear from the normalised value with fixed thresholds", () => {
    const wear = (value: number) =>
      countersFrom(
        [row("177", 999, "passed", value)],
        { wear: "177", written: null },
        NO_ACCEPTANCES,
      ).wearPercent;
    expect(wear(21)).toEqual({ value: 79, status: "passed" });
    expect(wear(20)).toEqual({ value: 80, status: "warning" });
    expect(wear(0)).toEqual({ value: 100, status: "failed" });
    expect(wear(200)).toEqual({ value: 0, status: "passed" });
  });
});

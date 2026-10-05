import { describe, expect, it } from "vitest";
import { readFixture } from "../../test/fixtures";
import { assembledWeek, extractSeagateFarm, farmWwn } from "./seagateFarm";
import { parse } from "./smartctl-xall";

const farmOf = (fixture: string) =>
  parse(readFixture(`mars/smartctl/${fixture}`), {}).data.farm;

describe("extractSeagateFarm", () => {
  it("parses a FARM 4.x SATA log", () => {
    const farm = farmOf("xall-sdf-auto.json");
    expect(farm).toMatchObject({
      interface: "ata",
      logVersion: "4.19",
      serial: "IEQ07JCE",
      wwn: "5000c506ced04297",
      powerOnHours: 33091,
      spindleHours: 33023,
      powerCycles: 77,
      heads: 12,
      recordingType: "CMR",
      assembledWeek: "2022-W03",
      heliumPressureTripped: false,
    });
    expect(farm?.perHead).toHaveLength(12);
    expect(farm?.perHead[0]).toEqual({
      mrResistance: expect.any(Number),
      secondMrResistance: expect.any(Number),
      reallocatedSectors: expect.any(Number),
      reallocationCandidates: expect.any(Number),
      writeWorkloadPowerOn: expect.any(Number),
      unrecoverableReadsRepeating: expect.any(Number),
      unrecoverableReadsUnique: expect.any(Number),
      skipWriteDetections: expect.any(Number),
    });
    expect(farm?.workload.sectorsWritten).toBeGreaterThan(0);
    expect(farm?.environment.specifiedMaxCelsius).toBe(60);
  });

  it("keeps the serial and WWN in the same form as the drive identity", () => {
    const { data } = parse(readFixture("mars/smartctl/xall-sdf-auto.json"), {});
    expect(data.farm?.serial).toBe(data.identity.serial);
    expect(data.farm?.wwn).toBe(data.identity.wwn);
  });

  it("parses a FARM 3.x log without an assembly date", () => {
    const farm = farmOf("xall-sdj-auto.json");
    expect(farm?.logVersion).toBe("3.7");
    expect(farm?.assembledWeek).toBeUndefined();
    expect(farm?.perHead).toHaveLength(18);
  });

  it("drops voltages the drive reports as zero", () => {
    const farm = farmOf("xall-sdi-auto.json");
    expect(farm?.environment.millivolts12?.current).toBeUndefined();
    expect(farm?.environment.millivolts12?.minimum).toBeGreaterThan(11000);
  });

  it("is absent on drives without FARM", () => {
    expect(farmOf("xall-sda-auto.json")).toBeUndefined();
    expect(farmOf("xall-nvme0.json")).toBeUndefined();
    expect(extractSeagateFarm({ supported: true })).toBeUndefined();
  });

  it("parses a SAS log", () => {
    const farm = extractSeagateFarm({
      log_header: { farm_log_version: [4, 2] },
      drive_information: {
        serial_number: "ZA000000",
        world_wide_name: "0x5000C500AAAAAAAA",
        number_of_heads: 2,
        power_on_hour: 1200,
        power_cycle_count: 9,
        hardware_reset_count: 4,
        date_of_assembled: "2310",
      },
      drive_information_continued: { drive_recording_type: "CMR" },
      workload_statistics: { total_number_of_read_commands: 10 },
      error_statistics: { unrecoverable_read_errors: 1 },
      environment_statistics: { highest_temperature: 50 },
      reliability_statistics: { helium_pressure_threshold_tripped: 1 },
      head_information: {
        mr_head_resistance_0: 400,
        mr_head_resistance_1: 410,
        "write_power_on_(sec)_1": 3600,
      },
    });
    expect(farm).toMatchObject({
      interface: "scsi",
      logVersion: "4.2",
      wwn: "5000c500aaaaaaaa",
      powerOnHours: 1200,
      resetCount: 4,
      assembledWeek: "2023-W10",
      recordingType: "CMR",
      heliumPressureTripped: true,
      workload: { readCommands: 10 },
      errors: { unrecoverableReads: 1 },
      environment: { highestCelsius: 50 },
    });
    expect(farm?.perHead).toEqual([
      { mrResistance: 400 },
      { mrResistance: 410, writeWorkloadPowerOn: 3600 },
    ]);
  });
});

describe("assembledWeek", () => {
  it.each([
    ["2203", "2022-W03"],
    ["2553", "2025-W53"],
    ["", undefined],
    ["2200", undefined],
    ["2254", undefined],
    ["22-3", undefined],
    [undefined, undefined],
  ])("%s → %s", (raw, week) => {
    expect(assembledWeek(raw)).toBe(week);
  });
});

describe("farmWwn", () => {
  it.each([
    ["0x5000c500db88b116", "5000c500db88b116"],
    ["0x5000C500DB88B116 ", "5000c500db88b116"],
    ["5000c500db88b116", "5000c500db88b116"],
    ["0x0", undefined],
    ["", undefined],
  ])("%s → %s", (raw, wwn) => {
    expect(farmWwn(raw)).toBe(wwn);
  });
});

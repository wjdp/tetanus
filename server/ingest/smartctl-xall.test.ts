import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readFixture, readFixtureExit } from "../../test/fixtures";
import { ParseError } from "./parseError";
import { parse } from "./smartctl-xall";

const FIXTURES_ROOT = join(import.meta.dirname, "..", "..", "test", "fixtures");

const marsAutoFixtures = readdirSync(join(FIXTURES_ROOT, "mars", "smartctl"))
  .filter((name) => name.endsWith("-auto.json") || name === "xall-nvme0.json")
  .map((name) => `mars/smartctl/${name}`);

const scrutinyFixtures = readdirSync(join(FIXTURES_ROOT, "scrutiny"))
  .filter((name) => name.endsWith(".json") && name !== "expected.json")
  .map((name) => `scrutiny/${name}`);

describe("smartctl-xall parser", () => {
  it.each([...marsAutoFixtures, ...scrutinyFixtures])(
    "parses %s",
    (relativePath) => {
      const body = readFixture(relativePath);
      let exitStatus: number | undefined;
      try {
        exitStatus = readFixtureExit(relativePath);
      } catch {
        exitStatus = undefined;
      }
      const { data, summary } = parse(
        body,
        exitStatus === undefined ? {} : { exitStatus },
      );
      expect(data.smartctl.exitStatus.raw).toBeTypeOf("number");
      expect(typeof summary.model).toBe("string");
      expect(typeof summary.serial).toBe("string");
      expect(typeof summary.exitStatus).toBe("number");
      expect(summary.standby === 0 || summary.standby === 1).toBe(true);
    },
  );

  it("rejects an empty body", () => {
    expect(() => parse("", {})).toThrow(ParseError);
  });

  it("rejects invalid JSON", () => {
    expect(() => parse("not json", {})).toThrow(ParseError);
  });

  it("parses an ATA drive (WD)", () => {
    const body = readFixture("mars/smartctl/xall-sda-auto.json");
    const exitStatus = readFixtureExit("mars/smartctl/xall-sda-auto.json");
    const { data } = parse(body, { exitStatus });
    expect(data.identity.model).toBe("WDC WD120EMAZ-11BLFA0");
    expect(data.identity.wwn).toBe("5000cca5f853b4e6");
    expect(data.ata?.attributes.length).toBeGreaterThan(0);
    const rawReadErrorRate = data.ata?.attributes.find(
      (attribute) => attribute.id === 1,
    );
    expect(rawReadErrorRate?.name).toBe("Raw_Read_Error_Rate");
    expect(rawReadErrorRate?.flags.prefailure).toBe(true);
    expect(rawReadErrorRate?.whenFailed).toBeNull();
    expect(data.standby).toBe(false);
  });

  it("parses an NVMe drive", () => {
    const body = readFixture("mars/smartctl/xall-nvme0.json");
    const exitStatus = readFixtureExit("mars/smartctl/xall-nvme0.json");
    const { data } = parse(body, { exitStatus });
    expect(data.identity.capacityBytes).toBe(250059350016);
    expect(data.nvme?.powerCycles).toBe(144);
    expect(data.nvme?.powerOnHours).toBe(48988);
    expect(data.identity.wwn).toBeUndefined();
  });

  it("parses a SCSI drive", () => {
    const body = readFixture("scrutiny/smart-scsi.json");
    const { data } = parse(body, {});
    expect(data.scsi?.grownDefects).toBe(56);
    expect(data.scsi?.read?.correctedErrors).toBe(300357663);
    expect(data.scsi?.read?.uncorrectedErrors).toBe(0);
  });

  it("decodes a deviceOpenFailed exit with no data as standby", () => {
    const body = readFixture("scrutiny/smart-fail.json");
    const { data, summary } = parse(body, {});
    expect(data.smartctl.exitStatus.raw).toBe(2);
    expect(data.smartctl.exitStatus.deviceOpenFailed).toBe(true);
    expect(data.standby).toBe(true);
    expect(summary.standby).toBe(1);
  });

  it("parses a failing drive", () => {
    const body = readFixture("scrutiny/smart-fail2.json");
    const { data } = parse(body, {});
    expect(data.smartctl.exitStatus.diskFailing).toBe(true);
    expect(data.identity.model).toBe("Hitachi HDS721050DLE630");
  });

  it("reassembles the WWN from naa/oui/id", () => {
    const body = readFixture("mars/smartctl/xall-sdj-auto.json");
    const exitStatus = readFixtureExit("mars/smartctl/xall-sdj-auto.json");
    const { data } = parse(body, { exitStatus });
    expect(data.identity.wwn).toBe("5000c5006d431bd1");
  });

  it("handles both smart_support shapes", () => {
    const objectShape = parse(readFixture("mars/smartctl/xall-sda-auto.json"), {
      exitStatus: readFixtureExit("mars/smartctl/xall-sda-auto.json"),
    });
    expect(objectShape.data.smartSupport).toEqual({
      available: true,
      enabled: true,
    });

    const booleanShapeBody = JSON.stringify({
      smartctl: { version: [7, 5], exit_status: 0 },
      device: { name: "/dev/sdz", type: "scsi", protocol: "SCSI" },
      smart_support: true,
    });
    const booleanShape = parse(booleanShapeBody, { exitStatus: 0 });
    expect(booleanShape.data.smartSupport).toEqual({
      available: true,
      enabled: true,
    });
  });
});

// Sanity check the fixture counts documented in the 010 contract.
describe("smartctl-xall fixture inventory", () => {
  it("covers every mars auto fixture and all 18 scrutiny fixtures", () => {
    expect(marsAutoFixtures.length).toBeGreaterThan(0);
    expect(scrutinyFixtures).toHaveLength(18);
  });
});

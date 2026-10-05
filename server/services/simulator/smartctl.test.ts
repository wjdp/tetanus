import { describe, expect, it } from "vitest";
import { evaluateReading } from "#shared/smart/evaluate";
import { parse } from "~~/server/ingest/smartctl-xall";
import { readFixture } from "~~/test/fixtures";
import type { StoredPayload } from "./payloads";
import {
  ataAttribute,
  capacityBlocks,
  defaultFailingLba,
  EXIT_BITS,
  editSmartctl,
  failHealth,
  failSelfTest,
  parseSmartctl,
  setAtaRaw,
  setNvmeCriticalWarning,
  setNvmeMediaErrors,
  setTemperature,
  setWear,
  supportsWear,
} from "./smartctl";

function stored(fixture: string): StoredPayload {
  return {
    source: "smartctl-xall",
    device: "/dev/sdx",
    meta: { device: "/dev/sdx", exitStatus: 0 },
    producer: null,
    body: readFixture(`mars/smartctl/${fixture}`),
  };
}

const SEAGATE = "xall-sdh-auto.json";
const SAMSUNG_SSD = "xall-sdm-auto.json";
const INTEL_SSD = "xall-sdn-auto.json";
const HDD_WITHOUT_WEAR = "xall-sda-auto.json";
const NVME = "xall-nvme0.json";

function evaluate(payload: StoredPayload) {
  const { data } = parse(payload.body, payload.meta);
  return { data, ...evaluateReading(data) };
}

const attribute = (payload: StoredPayload, attrId: string) =>
  evaluate(payload).attributes.find((each) => each.attrId === attrId);

const edit = (fixture: string, change: Parameters<typeof editSmartctl>[1]) =>
  editSmartctl(stored(fixture), change);

describe("ATA attributes", () => {
  it.each([
    ["5", 24],
    ["198", 16],
    ["188", 120],
  ])("fails defect attribute %s at %i", (attrId, raw) => {
    const payload = edit(SEAGATE, (json) => setAtaRaw(json, +attrId, raw));
    expect(attribute(payload, attrId)).toMatchObject({
      transformedValue: raw,
      status: "failed",
    });
  });

  it("keeps UDMA CRC errors a context attribute", () => {
    const payload = edit(SEAGATE, (json) => setAtaRaw(json, 199, 40));
    expect(attribute(payload, "199")).toMatchObject({
      transformedValue: 40,
      attributeClass: "context",
      status: "passed",
    });
  });
});

describe("failHealth", () => {
  it("fails the assessment in body and exit status", () => {
    const payload = failHealth(stored(SEAGATE));
    expect(payload.meta.exitStatus).toBe(EXIT_BITS.diskFailing);
    expect(parseSmartctl(payload.body).smartctl).toMatchObject({
      exit_status: EXIT_BITS.diskFailing,
    });
    expect(evaluate(payload).deviceStatus).toBe("failed");
  });
});

describe("NVMe", () => {
  it("raises a critical warning and fails health as smartctl does", () => {
    const payload = setNvmeCriticalWarning(stored(NVME), 1);
    const { data, deviceStatus, attributes } = evaluate(payload);
    expect(data.smartStatus?.passed).toBe(false);
    expect(data.smartctl.exitStatus.diskFailing).toBe(true);
    expect(deviceStatus).toBe("failed");
    const byId = new Map(attributes.map((each) => [each.attrId, each]));
    expect(byId.get("critical_warning")).toMatchObject({
      value: 1,
      status: "failed",
    });
    expect(byId.get("available_spare")).toMatchObject({
      value: 9,
      status: "failed",
    });
  });

  it("leaves the spare alone for other warnings", () => {
    const payload = setNvmeCriticalWarning(stored(NVME), 8);
    expect(attribute(payload, "available_spare")?.status).toBe("passed");
    expect(attribute(payload, "critical_warning")?.value).toBe(8);
  });

  it("fails on media errors", () => {
    const payload = edit(NVME, (json) => setNvmeMediaErrors(json, 4));
    expect(attribute(payload, "media_errors")).toMatchObject({
      value: 4,
      status: "failed",
    });
  });
});

describe("setWear", () => {
  it("sets NVMe percentage used, failing only past 100", () => {
    const nearly = edit(NVME, (json) => setWear(json, 98));
    expect(attribute(nearly, "percentage_used")).toMatchObject({
      value: 98,
      status: "passed",
    });
    const past = edit(NVME, (json) => setWear(json, 101));
    expect(attribute(past, "percentage_used")?.status).toBe("failed");
  });

  it("lowers Samsung Wear_Leveling_Count and the endurance statistic", () => {
    const payload = edit(SAMSUNG_SSD, (json) => setWear(json, 98));
    expect(attribute(payload, "177")).toMatchObject({ value: 2, worst: 2 });
    const statistics = parseSmartctl(payload.body).ata_device_statistics as {
      pages: { table?: { name: string; value: number }[] }[];
    };
    const endurance = statistics.pages
      .flatMap((page) => page.table ?? [])
      .find((row) => row.name === "Percentage Used Endurance Indicator");
    expect(endurance?.value).toBe(98);
  });

  it("matches wear attributes by name, not id", () => {
    const payload = edit(INTEL_SSD, (json) => setWear(json, 98));
    expect(attribute(payload, "245")).toMatchObject({ value: 2, rawValue: 2 });
    expect(attribute(payload, "233")?.value).toBe(100);
  });

  it("is supported only where a wear indicator exists", () => {
    const supported = (fixture: string) =>
      supportsWear(parseSmartctl(stored(fixture).body));
    expect(supported(NVME)).toBe(true);
    expect(supported(SAMSUNG_SSD)).toBe(true);
    expect(supported(HDD_WITHOUT_WEAR)).toBe(false);
  });
});

describe("setTemperature", () => {
  it("moves the current reading, attributes and SCT history on ATA", () => {
    const payload = edit(SEAGATE, (json) => setTemperature(json, 57));
    const { data, attributes } = evaluate(payload);
    expect(data.temperature).toBe(57);
    expect(data.sctTemperatureHistory?.values.at(-1)).toBe(57);
    const byId = new Map(attributes.map((each) => [each.attrId, each]));
    expect(byId.get("194")).toMatchObject({
      transformedValue: 57,
      rawString: "57 (0 19 0 0 0)",
      value: 57,
    });
    expect(byId.get("194")?.rawValue).toBe(
      (ataAttribute(parseSmartctl(stored(SEAGATE).body), 194)?.raw.value ?? 0) -
        41 +
        57,
    );
    expect(byId.get("190")).toMatchObject({ transformedValue: 57, value: 43 });
  });

  it("sets the NVMe health log temperature", () => {
    const payload = edit(NVME, (json) => setTemperature(json, 72));
    const { data } = evaluate(payload);
    expect(data.temperature).toBe(72);
    expect(attribute(payload, "temperature")?.value).toBe(72);
  });
});

describe("failSelfTest", () => {
  it("adds a failed extended test to the top of the ATA log", () => {
    const payload = failSelfTest(stored(SEAGATE), "extended", 123_456);
    const { data } = evaluate(payload);
    expect(data.smartctl.exitStatus.selfTestLogHasErrors).toBe(true);
    expect(data.selfTests?.[0]).toEqual({
      type: "Extended offline",
      status: "Completed: read failure",
      passed: false,
      lifetimeHours: data.powerOnHours,
      lba: 123_456,
    });
  });

  it("keeps earlier ATA entries below the new one", () => {
    const before = evaluate(stored("xall-sdj-auto.json")).data.selfTests ?? [];
    const payload = failSelfTest(stored("xall-sdj-auto.json"), "short", 7);
    const after = evaluate(payload).data.selfTests ?? [];
    expect(after).toHaveLength(before.length + 1);
    expect(after[0]).toMatchObject({ type: "Short offline", lba: 7 });
    expect(after.slice(1)).toEqual(before);
  });

  it("adds a failed test to the NVMe log", () => {
    const payload = failSelfTest(stored(NVME), "short", 42);
    const { data } = evaluate(payload);
    expect(data.selfTests).toEqual([
      {
        type: "Short",
        status: "Completed: failed segments",
        passed: false,
        lifetimeHours: 49_139,
        lba: 42,
      },
    ]);
  });
});

describe("defaultFailingLba", () => {
  it("is stable and within capacity", () => {
    const json = parseSmartctl(stored(SEAGATE).body);
    const lba = defaultFailingLba(json);
    expect(defaultFailingLba(json)).toBe(lba);
    expect(lba).toBeGreaterThanOrEqual(0);
    expect(lba).toBeLessThan(capacityBlocks(json) ?? 0);
  });
});

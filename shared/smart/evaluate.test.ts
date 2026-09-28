import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "../../server/ingest/smartctl-xall";
import { readFixture, readFixtureExit } from "../../test/fixtures";
import { attributeClass } from "./classification";
import { evaluateReading } from "./evaluate";
import { ATA_METADATA } from "./metadata";
import type { AttributeStatus } from "./status";

interface ExpectedAttribute {
  status?: number;
  value?: number;
  raw_value?: number;
  transformed_value?: number;
}

interface ExpectedFixture {
  device_status: number;
  attribute_count: number;
  attributes?: Record<string, ExpectedAttribute>;
}

const expected = JSON.parse(readFixture("scrutiny/expected.json")) as Record<
  string,
  ExpectedFixture | string | null
>;

const DIVERGENT_FIXTURES = new Set([
  "smart-scsi.json",
  "smart-fail.json",
  // Scrutiny fails the disk on context-class 199 at a 20% observed rate.
  "smart-ata-failed-scrutiny.json",
]);

const SCRUTINY_WARNING = 2;
const TRANSFORM_PARITY_ATTRIBUTES = new Set(["188", "194"]);

const scrutinyCases = Object.entries(expected).filter(
  (entry): entry is [string, ExpectedFixture] =>
    typeof entry[1] === "object" &&
    entry[1] !== null &&
    !DIVERGENT_FIXTURES.has(entry[0]),
);

function attributeStatus(bitmask: number): AttributeStatus {
  if (bitmask === 0) return "passed";
  if (bitmask === 2) return "warning";
  return "failed";
}

function evaluateFixture(relativePath: string) {
  let exitStatus: number | undefined;
  try {
    exitStatus = readFixtureExit(relativePath);
  } catch {
    exitStatus = undefined;
  }
  const { data } = parse(
    readFixture(relativePath),
    exitStatus === undefined ? {} : { exitStatus },
  );
  return evaluateReading(data);
}

describe("evaluateReading against scrutiny's expectations", () => {
  it.each(scrutinyCases)("%s", (fixture, expectation) => {
    const { deviceStatus, attributes } = evaluateFixture(`scrutiny/${fixture}`);
    expect(attributes).toHaveLength(expectation.attribute_count);

    if (expectation.device_status !== 0) expect(deviceStatus).toBe("failed");
    else expect(deviceStatus).not.toBe("failed");

    for (const [attrId, want] of Object.entries(expectation.attributes ?? {})) {
      const attribute = attributes.find((a) => a.attrId === attrId);
      expect(attribute, attrId).toBeDefined();
      // Context-class attributes never take status from observed rates, and
      // warnings from scrutiny's non-critical rules no longer exist.
      if (
        want.status !== undefined &&
        want.status !== SCRUTINY_WARNING &&
        attributeClass(attrId) === "defect"
      ) {
        expect(attribute?.status).toBe(attributeStatus(want.status));
      }
      if (want.value !== undefined) expect(attribute?.value).toBe(want.value);
      if (want.raw_value !== undefined) {
        expect(attribute?.rawValue).toBe(want.raw_value);
      }
      // Elsewhere we decode smartctl's raw string where scrutiny does not.
      if (
        want.transformed_value !== undefined &&
        TRANSFORM_PARITY_ATTRIBUTES.has(attrId)
      ) {
        expect(attribute?.transformedValue).toBe(want.transformed_value);
      }
    }
  });

  it("fails smart-scsi.json on 56 grown defects, which scrutiny misses by reading NVMe metadata", () => {
    const { deviceStatus, attributes } = evaluateFixture(
      "scrutiny/smart-scsi.json",
    );
    expect(attributes).toHaveLength(13);
    expect(deviceStatus).toBe("failed");
    const grownDefects = attributes.find(
      (a) => a.attrId === "scsi_grown_defect_list",
    );
    expect(grownDefects).toMatchObject({
      value: 56,
      thresh: 0,
      status: "failed",
    });
    expect(
      attributes.find((a) => a.attrId === "read_errors_corrected_by_eccfast"),
    ).toMatchObject({ value: 300357663, status: "passed" });
    expect(attributes.filter((a) => a.status !== "passed")).toHaveLength(1);
  });

  it("reports smart-fail.json (device open failed, no data) as unknown, where scrutiny says failed", () => {
    expect(evaluateFixture("scrutiny/smart-fail.json")).toEqual({
      deviceStatus: "unknown",
      attributes: [],
    });
  });

  it("keeps smart-ata-failed-scrutiny.json passed, where scrutiny fails it on context-class 199", () => {
    const { deviceStatus, attributes } = evaluateFixture(
      "scrutiny/smart-ata-failed-scrutiny.json",
    );
    expect(attributes).toHaveLength(14);
    expect(deviceStatus).toBe("passed");
    const crcErrors = attributes.find((a) => a.attrId === "199");
    expect(crcErrors).toMatchObject({
      attributeClass: "context",
      status: "passed",
    });
    expect(crcErrors?.failureRate).toBeGreaterThanOrEqual(0.2);
    expect(crcErrors?.reason).toBeUndefined();
  });

  it("treats threshold -1 attributes as informational", () => {
    const { attributes } = evaluateFixture("scrutiny/smart-nvme-failed.json");
    const temperature = attributes.find((a) => a.attrId === "temperature");
    expect(temperature?.status).toBe("passed");
    expect(temperature?.thresh).toBeUndefined();
    expect(temperature?.reason).toBeUndefined();
  });

  it("marks an attribute failing now as failed without consulting thresholds", () => {
    const { attributes } = evaluateFixture("scrutiny/smart-fail2.json");
    const reallocated = attributes.find((a) => a.attrId === "5");
    expect(reallocated).toMatchObject({ whenFailed: "now", status: "failed" });
    expect(reallocated?.failureRate).toBeUndefined();
  });

  it("is unknown when a device reports neither overall health nor data", () => {
    expect(evaluateFixture("scrutiny/smart-raid.json").deviceStatus).toBe(
      "unknown",
    );
  });
});

const MARS_ROOT = join(
  import.meta.dirname,
  "../../test/fixtures/mars/smartctl",
);
const marsFixtures = readdirSync(MARS_ROOT).filter(
  (name) => name.endsWith("-auto.json") || name === "xall-nvme0.json",
);

const MARS_FAILURES: Record<string, string[]> = {
  "xall-sdb-auto.json": ["197", "198"],
  "xall-sdj-auto.json": ["187"],
};

describe("evaluateReading on mars", () => {
  it.each(marsFixtures)("%s", (name) => {
    const { deviceStatus, attributes } = evaluateFixture(
      `mars/smartctl/${name}`,
    );
    expect(attributes.length).toBeGreaterThan(0);
    const failedIds = attributes
      .filter(({ status }) => status === "failed")
      .map(({ attrId }) => attrId);
    const expectedFailures = MARS_FAILURES[name] ?? [];
    expect(failedIds).toEqual(expectedFailures);
    expect(deviceStatus).toBe(
      expectedFailures.length > 0 ? "failed" : "passed",
    );
  });

  function marsAttribute(name: string, attrId: string) {
    const attribute = evaluateFixture(`mars/smartctl/${name}`).attributes.find(
      (a) => a.attrId === attrId,
    );
    expect(attribute, `${name} ${attrId}`).toBeDefined();
    return attribute;
  }

  it.each([
    "xall-sdd-auto.json",
    "xall-sde-auto.json",
    "xall-sdf-auto.json",
    "xall-sdg-auto.json",
    "xall-sdh-auto.json",
    "xall-sdi-auto.json",
    "xall-sdk-auto.json",
    "xall-sdl-auto.json",
  ])("keeps %s passed with start/stop count as context", (name) => {
    expect(evaluateFixture(`mars/smartctl/${name}`).deviceStatus).toBe(
      "passed",
    );
    const startStop = marsAttribute(name, "4");
    expect(startStop).toMatchObject({
      attributeClass: "context",
      status: "passed",
    });
    expect(startStop?.failureRate).toBeDefined();
  });

  it("fails sdb on 197 and on 198 above the top bucket", () => {
    expect(
      evaluateFixture("mars/smartctl/xall-sdb-auto.json").deviceStatus,
    ).toBe("failed");
    expect(marsAttribute("xall-sdb-auto.json", "197")?.status).toBe("failed");
    const topBucket = ATA_METADATA["198"]?.observedThresholds?.at(-1);
    expect(marsAttribute("xall-sdb-auto.json", "198")).toMatchObject({
      transformedValue: 18,
      status: "failed",
      failureRate: topBucket?.annualFailureRate,
    });
    expect(18).toBeGreaterThan(topBucket?.high ?? Infinity);
  });

  it("fails sdj on 187", () => {
    expect(
      evaluateFixture("mars/smartctl/xall-sdj-auto.json").deviceStatus,
    ).toBe("failed");
    expect(marsAttribute("xall-sdj-auto.json", "187")).toMatchObject({
      attributeClass: "defect",
      status: "failed",
    });
  });

  it.each(["xall-sdn-auto.json", "xall-sdp-auto.json"])(
    "keeps %s passed when 201 has no buckets",
    (name) => {
      expect(evaluateFixture(`mars/smartctl/${name}`).deviceStatus).toBe(
        "passed",
      );
      const softReadErrors = marsAttribute(name, "201");
      expect(softReadErrors).toMatchObject({
        attributeClass: "defect",
        status: "passed",
      });
      expect(softReadErrors?.failureRate).toBeUndefined();
      expect(softReadErrors?.reason).toBeUndefined();
    },
  );

  it("decodes packed raw values from smartctl's raw string", () => {
    expect(marsAttribute("xall-sdj-auto.json", "1")?.transformedValue).toBe(0);
    expect(marsAttribute("xall-sda-auto.json", "3")?.transformedValue).toBe(
      398,
    );
  });
});

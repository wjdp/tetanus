import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "../../server/ingest/smartctl-xall";
import { readFixture, readFixtureExit } from "../../test/fixtures";
import { evaluateReading } from "./evaluate";
import type { AttributeStatus, DeviceStatus } from "./status";

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

const DIVERGENT_FIXTURES = new Set(["smart-scsi.json", "smart-fail.json"]);

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

    // Scrutiny's device bitmask has no warning bit; our warning is its passed.
    const anyWarning = attributes.some(({ status }) => status === "warning");
    const expectedDevice: DeviceStatus =
      expectation.device_status !== 0
        ? "failed"
        : anyWarning
          ? "warning"
          : "passed";
    expect(deviceStatus).toBe(expectedDevice);

    for (const [attrId, want] of Object.entries(expectation.attributes ?? {})) {
      const attribute = attributes.find((a) => a.attrId === attrId);
      expect(attribute, attrId).toBeDefined();
      if (want.status !== undefined) {
        expect(attribute?.status).toBe(attributeStatus(want.status));
      }
      if (want.value !== undefined) expect(attribute?.value).toBe(want.value);
      if (want.raw_value !== undefined) {
        expect(attribute?.rawValue).toBe(want.raw_value);
      }
      if (want.transformed_value !== undefined) {
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
  "xall-sdb-auto.json": ["197"],
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
    if (expectedFailures.length > 0) expect(deviceStatus).toBe("failed");
    else expect(["passed", "warning"]).toContain(deviceStatus);
  });
});

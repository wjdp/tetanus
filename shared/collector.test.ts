import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  COLLECTOR_VERSION,
  collectorStatus,
  MIN_COLLECTOR_VERSION,
  parseCollectorProducer,
} from "./collector";

const hostFile = (path: string) =>
  readFileSync(join(import.meta.dirname, "../host", path), "utf8");

describe("collectorStatus", () => {
  it.each([
    [null, "unknown"],
    ["", "unknown"],
    ["1", "unknown"],
    ["0.3", "unknown"],
    ["0.3.0-rc1", "unknown"],
    ["0.2.9", "incompatible"],
    ["0.1.12", "incompatible"],
    [MIN_COLLECTOR_VERSION, "outdated"],
    [COLLECTOR_VERSION, "current"],
    ["0.3.10", "current"],
    ["1.0.0", "current"],
  ] as const)("%s is %s", (version, status) => {
    expect(collectorStatus(version)).toBe(status);
  });
});

describe("parseCollectorProducer", () => {
  it.each([
    ["tetanus-collect/0.3.1", "0.3.1"],
    ["tetanus-collect/1", null],
    ["tetanus-zed/0.3.1", null],
    ["curl/8.5.0", null],
    [null, null],
  ])("%s → %s", (producer, version) => {
    expect(parseCollectorProducer(producer)).toBe(version);
  });
});

describe("host scripts", () => {
  it("tetanus-collect declares COLLECTOR_VERSION", () => {
    expect(hostFile("tetanus-collect")).toContain(
      `readonly version=${COLLECTOR_VERSION}\n`,
    );
  });

  it("the zedlet sends COLLECTOR_VERSION", () => {
    expect(hostFile("zed/all-tetanus.sh")).toContain(
      `readonly version=${COLLECTOR_VERSION}\n`,
    );
  });
});

import type { Parser } from "#shared/ingest";
import { ParseError } from "./parseError";

export interface ZfsSnapshot {
  name: string;
  dataset: string;
  snapshot: string;
  used: number;
  referenced: number;
  written: number;
  creation: number;
}

export interface ZfsSnapshotsResult {
  snapshots: ZfsSnapshot[];
}

function parseJson(body: string): Record<string, unknown> {
  if (body.trim() === "") throw new ParseError("Empty zfs-snapshots body");
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    throw new ParseError("zfs-snapshots body is not valid JSON");
  }
  if (typeof json !== "object" || json === null) {
    throw new ParseError("zfs-snapshots body is not a JSON object");
  }
  return json as Record<string, unknown>;
}

function toNumber(value: unknown, label: string): number {
  if (typeof value === "number") return value;
  if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value)) {
    return Number(value);
  }
  throw new ParseError(`Expected a number for ${label}`);
}

function propertyValue(
  properties: Record<string, unknown>,
  key: string,
  label: string,
): number {
  const property = properties[key] as Record<string, unknown> | undefined;
  if (!property) throw new ParseError(`Missing property ${label}`);
  return toNumber(property.value, label);
}

function parseSnapshot(
  name: string,
  raw: Record<string, unknown>,
): ZfsSnapshot {
  const at = name.indexOf("@");
  if (at === -1) {
    throw new ParseError(`Snapshot name has no '@': ${name}`);
  }
  const rawProperties = raw.properties;
  if (typeof rawProperties !== "object" || rawProperties === null) {
    throw new ParseError(`Snapshot ${name} has no properties`);
  }
  const properties = rawProperties as Record<string, unknown>;

  return {
    name,
    dataset: name.slice(0, at),
    snapshot: name.slice(at + 1),
    used: propertyValue(properties, "used", `${name}.used`),
    referenced: propertyValue(properties, "referenced", `${name}.referenced`),
    written: propertyValue(properties, "written", `${name}.written`),
    creation: propertyValue(properties, "creation", `${name}.creation`),
  };
}

export const parse: Parser<ZfsSnapshotsResult> = (body) => {
  const json = parseJson(body);
  const outputVersion = json.output_version as
    | Record<string, unknown>
    | undefined;
  if (outputVersion?.vers_major !== 0) {
    throw new ParseError("Unsupported zfs-snapshots output_version.vers_major");
  }
  const rawDatasets = json.datasets;
  if (typeof rawDatasets !== "object" || rawDatasets === null) {
    throw new ParseError("zfs-snapshots body has no datasets");
  }
  const snapshots = Object.entries(rawDatasets as Record<string, unknown>).map(
    ([name, raw]) => {
      if (typeof raw !== "object" || raw === null) {
        throw new ParseError(`Snapshot ${name} is not an object`);
      }
      return parseSnapshot(name, raw as Record<string, unknown>);
    },
  );

  return { data: { snapshots }, summary: { snapshots: snapshots.length } };
};

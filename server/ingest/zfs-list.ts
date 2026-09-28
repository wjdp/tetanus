import type { Parser } from "#shared/ingest";
import { ParseError } from "./parseError";

export interface ZfsPropertySource {
  type: string;
  data: string;
}

export interface ZfsProperty {
  value: number | string;
  source: ZfsPropertySource;
}

export type ZfsDatasetType = "filesystem" | "volume";

export interface ZfsDataset {
  name: string;
  pool: string;
  type: ZfsDatasetType;
  properties: Record<string, ZfsProperty>;
}

export interface ZfsListResult {
  datasets: ZfsDataset[];
}

const DATASET_TYPE: Record<string, ZfsDatasetType> = {
  FILESYSTEM: "filesystem",
  VOLUME: "volume",
};

function parseJson(body: string): Record<string, unknown> {
  if (body.trim() === "") throw new ParseError("Empty zfs-list body");
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    throw new ParseError("zfs-list body is not valid JSON");
  }
  if (typeof json !== "object" || json === null) {
    throw new ParseError("zfs-list body is not a JSON object");
  }
  return json as Record<string, unknown>;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new ParseError(`Expected a string for ${label}`);
  }
  return value;
}

function parseProperty(value: unknown, label: string): ZfsProperty {
  if (typeof value !== "object" || value === null) {
    throw new ParseError(`Expected a property object for ${label}`);
  }
  const raw = value as Record<string, unknown>;
  if (typeof raw.value !== "number" && typeof raw.value !== "string") {
    throw new ParseError(`Expected a number or string value for ${label}`);
  }
  const source = raw.source as Record<string, unknown> | undefined;
  return {
    value: raw.value,
    source: {
      type: requireString(source?.type, `${label}.source.type`),
      data: requireString(source?.data, `${label}.source.data`),
    },
  };
}

function parseDataset(name: string, raw: Record<string, unknown>): ZfsDataset {
  const rawType = requireString(raw.type, `${name}.type`);
  const type = DATASET_TYPE[rawType];
  if (!type) throw new ParseError(`Unknown dataset type: ${rawType}`);

  const rawProperties = raw.properties;
  if (typeof rawProperties !== "object" || rawProperties === null) {
    throw new ParseError(`Dataset ${name} has no properties`);
  }
  const properties: Record<string, ZfsProperty> = {};
  for (const [key, value] of Object.entries(
    rawProperties as Record<string, unknown>,
  )) {
    properties[key] = parseProperty(value, `${name}.${key}`);
  }

  return { name, pool: name.split("/")[0], type, properties };
}

export const parse: Parser<ZfsListResult> = (body) => {
  const json = parseJson(body);
  const outputVersion = json.output_version as
    | Record<string, unknown>
    | undefined;
  if (outputVersion?.vers_major !== 0) {
    throw new ParseError("Unsupported zfs-list output_version.vers_major");
  }
  const rawDatasets = json.datasets;
  if (typeof rawDatasets !== "object" || rawDatasets === null) {
    throw new ParseError("zfs-list body has no datasets");
  }
  const datasets = Object.entries(rawDatasets as Record<string, unknown>).map(
    ([name, raw]) => {
      if (typeof raw !== "object" || raw === null) {
        throw new ParseError(`Dataset ${name} is not an object`);
      }
      return parseDataset(name, raw as Record<string, unknown>);
    },
  );

  const filesystems = datasets.filter((d) => d.type === "filesystem").length;
  const volumes = datasets.filter((d) => d.type === "volume").length;

  return {
    data: { datasets },
    summary: { datasets: datasets.length, filesystems, volumes },
  };
};

import type { Parser } from "#shared/ingest";
import { ParseError } from "./parseError";

export interface ZpoolListPropertySource {
  type: string;
  data: string;
}

export interface ZpoolListProperty {
  value: number | string;
  source: ZpoolListPropertySource;
}

export interface ZpoolListPool {
  name: string;
  guid: string;
  properties: Record<string, ZpoolListProperty>;
}

export interface ZpoolListResult {
  pools: ZpoolListPool[];
}

function parseJson(body: string): Record<string, unknown> {
  if (body.trim() === "") throw new ParseError("Empty zpool-list body");
  const withStringGuids = body.replace(
    /"([a-zA-Z_]*guid[a-zA-Z_]*)":\s*(\d+)(?=[,}\s])/g,
    '"$1":"$2"',
  );
  let json: unknown;
  try {
    json = JSON.parse(withStringGuids);
  } catch {
    throw new ParseError("zpool-list body is not valid JSON");
  }
  if (typeof json !== "object" || json === null) {
    throw new ParseError("zpool-list body is not a JSON object");
  }
  return json as Record<string, unknown>;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new ParseError(`Expected a string for ${label}`);
  }
  return value;
}

function parseProperty(value: unknown, label: string): ZpoolListProperty {
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

function parsePool(name: string, raw: Record<string, unknown>): ZpoolListPool {
  const rawProperties = raw.properties;
  if (typeof rawProperties !== "object" || rawProperties === null) {
    throw new ParseError(`Pool ${name} has no properties`);
  }
  const properties: Record<string, ZpoolListProperty> = {};
  for (const [key, value] of Object.entries(
    rawProperties as Record<string, unknown>,
  )) {
    properties[key] = parseProperty(value, `${name}.${key}`);
  }
  return {
    name,
    guid: requireString(raw.pool_guid, `${name}.pool_guid`),
    properties,
  };
}

export const parse: Parser<ZpoolListResult> = (body) => {
  const json = parseJson(body);
  const outputVersion = json.output_version as
    | Record<string, unknown>
    | undefined;
  if (outputVersion?.vers_major !== 0) {
    throw new ParseError("Unsupported zpool-list output_version.vers_major");
  }
  const rawPools = json.pools;
  if (typeof rawPools !== "object" || rawPools === null) {
    throw new ParseError("zpool-list body has no pools");
  }
  const pools = Object.entries(rawPools as Record<string, unknown>).map(
    ([name, raw]) => {
      if (typeof raw !== "object" || raw === null) {
        throw new ParseError(`Pool ${name} is not an object`);
      }
      return parsePool(name, raw as Record<string, unknown>);
    },
  );

  return { data: { pools }, summary: { pools: pools.length } };
};

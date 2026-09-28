import type { Parser } from "#shared/ingest";
import { ParseError } from "./parseError";

export type VdevType =
  | "root"
  | "raidz1"
  | "raidz2"
  | "raidz3"
  | "mirror"
  | "disk"
  | "file"
  | "spare"
  | "log"
  | "cache"
  | "special"
  | "dedup"
  | "indirect"
  | "replacing";

export interface ZpoolStatusScan {
  function: string;
  state: string;
  startTime: number;
  endTime?: number;
  examined: number;
  toExamine: number;
  processed?: number;
  errors: number;
}

export interface ZpoolStatusVdev {
  guid: string;
  name: string;
  type: VdevType;
  parentGuid: string | null;
  path?: string;
  devid?: string;
  physPath?: string;
  state: string;
  readErrors: number;
  writeErrors: number;
  checksumErrors: number;
  slowIos?: number;
  allocSpace?: number;
  totalSpace?: number;
  fragmentation?: number;
  children: string[];
}

export interface ZpoolStatusPool {
  name: string;
  guid: string;
  state: string;
  status?: string;
  action?: string;
  errors?: number;
  scan: ZpoolStatusScan | null;
  vdevs: ZpoolStatusVdev[];
}

export interface ZpoolStatusResult {
  pools: ZpoolStatusPool[];
}

const KNOWN_VDEV_TYPES = new Set<string>([
  "root",
  "mirror",
  "disk",
  "file",
  "spare",
  "indirect",
  "replacing",
]);

// class -> type only applies to the top-level vdev of a non-normal group;
// members of the group (leaf disks) keep their own vdev_type ("disk").
const CLASS_TYPE: Record<string, VdevType> = {
  log: "log",
  logs: "log",
  cache: "cache",
  spare: "spare",
  spares: "spare",
  special: "special",
  dedup: "dedup",
};

function parseJson(body: string): Record<string, unknown> {
  if (body.trim() === "") throw new ParseError("Empty zpool-status body");
  const withStringGuids = body.replace(
    /"([a-zA-Z_]*guid[a-zA-Z_]*)":\s*(\d+)(?=[,}\s])/g,
    '"$1":"$2"',
  );
  let json: unknown;
  try {
    json = JSON.parse(withStringGuids);
  } catch {
    throw new ParseError("zpool-status body is not valid JSON");
  }
  if (typeof json !== "object" || json === null) {
    throw new ParseError("zpool-status body is not a JSON object");
  }
  return json as Record<string, unknown>;
}

function checkOutputVersion(json: Record<string, unknown>) {
  const outputVersion = json.output_version as
    | Record<string, unknown>
    | undefined;
  if (outputVersion?.vers_major !== 0) {
    throw new ParseError("Unsupported zpool-status output_version.vers_major");
  }
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new ParseError(`Expected a string for ${label}`);
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function toNumber(value: unknown, label: string): number {
  if (typeof value === "number") return value;
  if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value)) {
    return Number(value);
  }
  throw new ParseError(`Expected a number for ${label}`);
}

function optionalNumber(value: unknown, label: string): number | undefined {
  return value === undefined ? undefined : toNumber(value, label);
}

function guidString(value: unknown, fallback: string): string {
  if (value === undefined) return fallback;
  if (typeof value === "string" && /^\d+$/.test(value)) return value;
  throw new ParseError(
    `Expected a decimal guid string, got ${JSON.stringify(value)}`,
  );
}

interface RawVdev {
  [key: string]: unknown;
}

function isFlatVdevMap(poolVdevs: Record<string, RawVdev>): boolean {
  const entries = Object.values(poolVdevs);
  const root =
    entries.find((entry) => entry.vdev_type === "root") ?? entries[0];
  if (!root) return true;
  const nested = root.vdevs;
  if (typeof nested !== "object" || nested === null) return true;
  const nestedNames = Object.keys(nested as Record<string, unknown>);
  if (nestedNames.length === 0) return true;
  return nestedNames.some(
    (name) =>
      name in poolVdevs && name !== requireString(root.name, "vdev name"),
  );
}

function deriveType(raw: RawVdev, isTopLevelGroup: boolean): VdevType {
  const vdevType = raw.vdev_type;
  if (vdevType === undefined) return "disk"; // -L strips leaf metadata
  if (vdevType === "raidz") {
    const name = requireString(raw.name, "vdev name");
    const match = /^raidz([123])(-\d+)?$/.exec(name);
    // zpool status names raidz groups "raidzN-<n>"; that's the only place
    // the parity digit appears in the JSON. Under `-g` the name is replaced
    // by the guid and the parity is unrecoverable, so default to raidz1
    // rather than reject a payload that otherwise parses fine.
    return match ? (`raidz${match[1]}` as VdevType) : "raidz1";
  }
  if (
    isTopLevelGroup &&
    typeof raw.class === "string" &&
    raw.class !== "normal"
  ) {
    const mapped = CLASS_TYPE[raw.class];
    if (mapped) return mapped;
  }
  if (typeof vdevType !== "string" || !KNOWN_VDEV_TYPES.has(vdevType)) {
    throw new ParseError(`Unknown vdev_type: ${JSON.stringify(vdevType)}`);
  }
  return vdevType as VdevType;
}

function parsePool(
  name: string,
  raw: Record<string, unknown>,
): ZpoolStatusPool {
  const poolGuid = guidString(raw.pool_guid, name);
  const rawVdevs = raw.vdevs;
  if (typeof rawVdevs !== "object" || rawVdevs === null) {
    throw new ParseError(`Pool ${name} has no vdevs`);
  }
  const poolVdevs = rawVdevs as Record<string, RawVdev>;
  if (!isFlatVdevMap(poolVdevs)) {
    throw new ParseError(
      `Pool ${name}: expected --json-flat-vdevs output, got a nested vdev tree`,
    );
  }

  const guidByName = new Map<string, string>();
  for (const [vdevName, vdevRaw] of Object.entries(poolVdevs)) {
    guidByName.set(vdevName, guidString(vdevRaw.guid, vdevName));
  }
  const rootName = Object.entries(poolVdevs).find(
    ([, vdevRaw]) => vdevRaw.vdev_type === "root",
  )?.[0];
  const rootGuid = rootName ? guidByName.get(rootName) : undefined;

  const children = new Map<string, string[]>();
  const vdevs: ZpoolStatusVdev[] = [];
  for (const [vdevName, vdevRaw] of Object.entries(poolVdevs)) {
    const guid = guidByName.get(vdevName) ?? vdevName;
    const isTopLevelGroup =
      vdevRaw.parent === undefined && vdevRaw.vdev_type !== "root";
    const type = deriveType(vdevRaw, isTopLevelGroup);

    let parentGuid: string | null;
    if (typeof vdevRaw.parent === "string") {
      const resolved = guidByName.get(vdevRaw.parent);
      if (!resolved) {
        throw new ParseError(
          `Pool ${name}: vdev ${vdevName} references unknown parent ${vdevRaw.parent}`,
        );
      }
      parentGuid = resolved;
    } else if (type === "root") {
      parentGuid = null;
    } else if (rootGuid) {
      parentGuid = rootGuid;
    } else {
      parentGuid = null;
    }

    if (parentGuid !== null) {
      const siblings = children.get(parentGuid) ?? [];
      siblings.push(guid);
      children.set(parentGuid, siblings);
    }

    vdevs.push({
      guid,
      name: vdevName,
      type,
      parentGuid,
      path: optionalString(vdevRaw.path),
      devid: optionalString(vdevRaw.devid),
      physPath: optionalString(vdevRaw.phys_path),
      state: optionalString(vdevRaw.state) ?? "UNKNOWN",
      readErrors: toNumber(vdevRaw.read_errors, `${vdevName}.read_errors`),
      writeErrors: toNumber(vdevRaw.write_errors, `${vdevName}.write_errors`),
      checksumErrors: toNumber(
        vdevRaw.checksum_errors,
        `${vdevName}.checksum_errors`,
      ),
      slowIos: optionalNumber(vdevRaw.slow_ios, `${vdevName}.slow_ios`),
      allocSpace: optionalNumber(
        vdevRaw.alloc_space,
        `${vdevName}.alloc_space`,
      ),
      totalSpace: optionalNumber(
        vdevRaw.total_space,
        `${vdevName}.total_space`,
      ),
      fragmentation: optionalNumber(
        vdevRaw.fragmentation,
        `${vdevName}.fragmentation`,
      ),
      children: [],
    });
  }
  for (const vdev of vdevs) {
    vdev.children = children.get(vdev.guid) ?? [];
  }

  const rawScan = raw.scan_stats as Record<string, unknown> | undefined;
  const scan: ZpoolStatusScan | null = rawScan
    ? {
        function: requireString(rawScan.function, "scan.function"),
        state: requireString(rawScan.state, "scan.state"),
        startTime: toNumber(rawScan.start_time, "scan.start_time"),
        endTime: optionalNumber(rawScan.end_time, "scan.end_time"),
        examined: toNumber(rawScan.examined, "scan.examined"),
        toExamine: toNumber(rawScan.to_examine, "scan.to_examine"),
        processed: optionalNumber(rawScan.processed, "scan.processed"),
        errors: toNumber(rawScan.errors, "scan.errors"),
      }
    : null;

  return {
    name,
    guid: poolGuid,
    state: requireString(raw.state, "pool.state"),
    status: optionalString(raw.status),
    action: optionalString(raw.action),
    errors: optionalNumber(raw.error_count, "pool.error_count"),
    scan,
    vdevs,
  };
}

export const parse: Parser<ZpoolStatusResult> = (body) => {
  const json = parseJson(body);
  checkOutputVersion(json);
  const rawPools = json.pools;
  if (typeof rawPools !== "object" || rawPools === null) {
    throw new ParseError("zpool-status body has no pools");
  }
  const pools = Object.entries(rawPools as Record<string, unknown>).map(
    ([name, raw]) => {
      if (typeof raw !== "object" || raw === null) {
        throw new ParseError(`Pool ${name} is not an object`);
      }
      return parsePool(name, raw as Record<string, unknown>);
    },
  );

  const vdevCount = pools.reduce((sum, pool) => sum + pool.vdevs.length, 0);
  const diskCount = pools.reduce(
    (sum, pool) => sum + pool.vdevs.filter((v) => v.type === "disk").length,
    0,
  );

  return {
    data: { pools },
    summary: { pools: pools.length, vdevs: vdevCount, disks: diskCount },
  };
};

import type { Parser } from "#shared/ingest";
import {
  DAMAGED_FILES_LIMIT,
  LEAF_VDEV_TYPES,
  type VdevRole,
} from "#shared/zfsState";
import { ParseError } from "./parseError";

export type VdevType =
  | "root"
  | "raidz1"
  | "raidz2"
  | "raidz3"
  | "draid1"
  | "draid2"
  | "draid3"
  | "mirror"
  | "disk"
  | "file"
  | "dspare"
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
  issued?: number;
  pausedAt?: number;
  errors: number;
}

export interface ZpoolStatusVdev {
  guid: string;
  name: string;
  type: VdevType;
  role: VdevRole;
  spareState?: string;
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

export interface ZpoolStatusRemoval {
  state: string;
  removingVdev: number;
  startTime: number;
  endTime?: number;
  toCopy: number;
  copied: number;
  mappingMemory: number;
}

export interface ZpoolStatusPool {
  name: string;
  guid: string;
  state: string;
  status?: string;
  action?: string;
  msgid?: string;
  moreinfo?: string;
  errors?: number;
  damagedFiles?: string[];
  damagedFilesError?: string;
  scan: ZpoolStatusScan | null;
  removal: ZpoolStatusRemoval | null;
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

const DISTRIBUTED_SPARE_TYPES = new Set(["dspare", "dist-spare"]);

// class -> type only applies to the top-level vdev of a non-normal group;
// members of the group (leaf disks) keep their own vdev_type ("disk").
const CLASS_TYPE: Record<string, VdevType> = {
  log: "log",
  logs: "log",
  cache: "cache",
  l2cache: "cache",
  spare: "spare",
  spares: "spare",
  special: "special",
  dedup: "dedup",
};

const ROLE_BY_CLASS: Record<string, VdevRole> = {
  normal: "normal",
  ...CLASS_TYPE,
} as Record<string, VdevRole>;

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
  if (vdevType === "draid") {
    const name = requireString(raw.name, "vdev name");
    // dRAID groups are named "draidN:<d>d:<c>c:<s>s-<n>"; as with raidz, -g
    // loses the parity digit.
    const match = /^draid([123])/.exec(name);
    return match ? (`draid${match[1]}` as VdevType) : "draid1";
  }
  if (DISTRIBUTED_SPARE_TYPES.has(vdevType as string)) return "dspare";
  if (
    isTopLevelGroup &&
    !LEAF_VDEV_TYPES.has(String(vdevType)) &&
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

function findNestedEntry(
  vdevs: Record<string, RawVdev>,
  name: string,
): RawVdev | undefined {
  for (const entry of Object.values(vdevs)) {
    const nested = entry.vdevs as Record<string, RawVdev> | undefined;
    if (typeof nested !== "object" || nested === null) continue;
    const candidate = nested[name];
    if (candidate?.parent !== undefined) return candidate;
    const deeper = findNestedEntry(nested, name);
    if (deeper) return deeper;
  }
  return undefined;
}

// A spare's flat entry is its aux status (AVAIL, INUSE, …). While INUSE the
// flat map keeps only that aux entry under the shared name key; its in-pool
// copy, under spare-N, survives only in the nested vdevs maps.
function resolveSpareEntry(
  poolVdevs: Record<string, RawVdev>,
  vdevName: string,
  flat: RawVdev,
): { raw: RawVdev; spareState?: string } {
  if (flat.class !== "spare") return { raw: flat };
  const spareState = optionalString(flat.state);
  if (flat.parent !== undefined) return { raw: flat, spareState };
  return {
    raw: findNestedEntry(poolVdevs, vdevName) ?? flat,
    spareState,
  };
}

function counter(raw: RawVdev, key: string, label: string, isSpare: boolean) {
  if (isSpare && raw[key] === undefined) return 0;
  return toNumber(raw[key], label);
}

function resolveInheritedRoles(
  vdevs: ZpoolStatusVdev[],
  explicitRoles: Map<string, VdevRole>,
) {
  const byGuid = new Map(vdevs.map((vdev) => [vdev.guid, vdev]));
  const roleOf = (vdev: ZpoolStatusVdev): VdevRole => {
    const explicit = explicitRoles.get(vdev.guid);
    if (explicit) return explicit;
    const parent =
      vdev.parentGuid === null ? undefined : byGuid.get(vdev.parentGuid);
    return parent && parent.type !== "root" ? roleOf(parent) : "normal";
  };
  for (const vdev of vdevs) vdev.role = roleOf(vdev);
}

function parseScan(rawScan: Record<string, unknown>): ZpoolStatusScan {
  const pausedAt = optionalNumber(rawScan.scrub_pause, "scan.scrub_pause") ?? 0;
  return {
    function: requireString(rawScan.function, "scan.function"),
    state: requireString(rawScan.state, "scan.state"),
    startTime: toNumber(rawScan.start_time, "scan.start_time"),
    endTime: optionalNumber(rawScan.end_time, "scan.end_time"),
    examined: toNumber(rawScan.examined, "scan.examined"),
    toExamine: toNumber(rawScan.to_examine, "scan.to_examine"),
    processed: optionalNumber(rawScan.processed, "scan.processed"),
    issued: optionalNumber(rawScan.issued, "scan.issued"),
    pausedAt: pausedAt > 0 ? pausedAt : undefined,
    errors: toNumber(rawScan.errors, "scan.errors"),
  };
}

function parseRemoval(rawRemoval: Record<string, unknown>): ZpoolStatusRemoval {
  return {
    state: requireString(rawRemoval.state, "removal.state"),
    removingVdev: toNumber(rawRemoval.removing_vdev, "removal.removing_vdev"),
    startTime: toNumber(rawRemoval.start_time, "removal.start_time"),
    endTime: optionalNumber(rawRemoval.end_time, "removal.end_time"),
    toCopy: toNumber(rawRemoval.to_copy, "removal.to_copy"),
    copied: toNumber(rawRemoval.copied, "removal.copied"),
    mappingMemory: toNumber(
      rawRemoval.mapping_memory,
      "removal.mapping_memory",
    ),
  };
}

function parseErrlist(
  errlist: unknown,
): Pick<ZpoolStatusPool, "damagedFiles" | "damagedFilesError"> {
  if (typeof errlist === "string") return { damagedFilesError: errlist };
  if (!Array.isArray(errlist)) return {};
  return {
    damagedFiles: errlist
      .filter((entry): entry is string => typeof entry === "string")
      .slice(0, DAMAGED_FILES_LIMIT),
  };
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
  const explicitRoles = new Map<string, VdevRole>();
  for (const [vdevName, flatRaw] of Object.entries(poolVdevs)) {
    const { raw: vdevRaw, spareState } = resolveSpareEntry(
      poolVdevs,
      vdevName,
      flatRaw,
    );
    const guid = guidByName.get(vdevName) ?? vdevName;
    const isTopLevelGroup =
      vdevRaw.parent === undefined && vdevRaw.vdev_type !== "root";
    const type = deriveType(vdevRaw, isTopLevelGroup);
    const isSpare = vdevRaw.class === "spare";
    const explicitRole =
      typeof vdevRaw.class === "string"
        ? ROLE_BY_CLASS[vdevRaw.class]
        : undefined;
    if (explicitRole) explicitRoles.set(guid, explicitRole);

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
      role: "normal",
      spareState,
      parentGuid,
      path: optionalString(vdevRaw.path),
      devid: optionalString(vdevRaw.devid),
      physPath: optionalString(vdevRaw.phys_path),
      state: optionalString(vdevRaw.state) ?? "UNKNOWN",
      readErrors: counter(
        vdevRaw,
        "read_errors",
        `${vdevName}.read_errors`,
        isSpare,
      ),
      writeErrors: counter(
        vdevRaw,
        "write_errors",
        `${vdevName}.write_errors`,
        isSpare,
      ),
      checksumErrors: counter(
        vdevRaw,
        "checksum_errors",
        `${vdevName}.checksum_errors`,
        isSpare,
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
  resolveInheritedRoles(vdevs, explicitRoles);
  for (const vdev of vdevs) {
    vdev.children = children.get(vdev.guid) ?? [];
  }

  const rawScan = raw.scan_stats as Record<string, unknown> | undefined;
  const rawRemoval = raw.removal_stats as Record<string, unknown> | undefined;

  return {
    name,
    guid: poolGuid,
    state: requireString(raw.state, "pool.state"),
    status: optionalString(raw.status),
    action: optionalString(raw.action),
    msgid: optionalString(raw.msgid),
    moreinfo: optionalString(raw.moreinfo),
    errors: optionalNumber(raw.error_count, "pool.error_count"),
    ...parseErrlist(raw.errlist),
    scan: rawScan ? parseScan(rawScan) : null,
    removal: rawRemoval ? parseRemoval(rawRemoval) : null,
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

import type {
  DriveRecord,
  DriveSpec,
  DriveSpecSource,
} from "#shared/drive-spec";
import { bareModel, modelWithoutVendor } from "#shared/model";
import snapshotFile from "./nasdisks.json";
import overridesFile from "./overrides.json";

export const DRIVE_DB_SNAPSHOT: string = snapshotFile.snapshot;

interface IndexEntry {
  record: DriveRecord;
  source: DriveSpecSource;
  matchedModel: string;
}

type DriveIndex = Map<string, IndexEntry>;

export function buildDriveIndex(
  sources: { source: DriveSpecSource; drives: DriveRecord[] }[],
): DriveIndex {
  const index: DriveIndex = new Map();
  const secondary = new Map<string, IndexEntry | "ambiguous">();

  for (const { source, drives } of sources) {
    for (const record of drives) {
      for (const key of [record.model, ...record.also_sold_as]) {
        const entry = { record, source, matchedModel: key };
        const upper = key.toUpperCase();
        if (!index.has(upper)) index.set(upper, entry);
        const bare = bareModel(key)?.toUpperCase();
        if (bare && bare !== upper) {
          const existing = secondary.get(bare);
          if (existing === undefined) secondary.set(bare, entry);
          else if (existing !== "ambiguous" && existing.record !== record)
            secondary.set(bare, "ambiguous");
        }
      }
    }
  }

  for (const [key, entry] of secondary) {
    if (entry !== "ambiguous" && !index.has(key)) index.set(key, entry);
  }
  return index;
}

export function findInIndex(
  index: DriveIndex,
  model: string | null | undefined,
): IndexEntry | null {
  const candidates = [modelWithoutVendor(model), bareModel(model)]
    .filter((candidate): candidate is string => candidate !== null)
    .map((candidate) => candidate.toUpperCase());

  for (const candidate of candidates) {
    const hit = index.get(candidate);
    if (hit) return hit;
  }
  return null;
}

function toDriveSpec({ record, source, matchedModel }: IndexEntry): DriveSpec {
  return {
    source,
    snapshot: DRIVE_DB_SNAPSHOT,
    matchedModel,
    model: record.model,
    brand: record.brand,
    line: record.line,
    capacityTb: record.capacity_tb,
    rpm: record.rpm,
    cacheMb: record.cache_mb,
    interface: record.interface,
    formFactor: record.form_factor,
    recordingTech: record.recording_tech || null,
    ercTler: record.erc_tler,
    isHelium: record.is_helium,
    driveClass: record.drive_class,
    mediaType: record.media_type,
    inProduction: record.in_production,
    alsoSoldAs: record.also_sold_as,
    nandType: record.nand_type,
    tbwTb: record.tbw_tb,
    dwpd: record.dwpd,
    hasDram: record.has_dram,
    hasPlp: record.has_plp,
    sustainedWriteMbps: record.sustained_write_mbps,
    afrPct: record.afr_pct,
    reliabilityDriveCount: record.reliability_drive_count,
    reliabilitySource: record.reliability_source,
  };
}

let bundledIndex: DriveIndex | undefined;

function getBundledIndex(): DriveIndex {
  bundledIndex ??= buildDriveIndex([
    { source: "local", drives: overridesFile.drives as DriveRecord[] },
    { source: "nasdisks", drives: snapshotFile.drives as DriveRecord[] },
  ]);
  return bundledIndex;
}

export function lookupSpec(model: string | null | undefined): DriveSpec | null {
  const entry = findInIndex(getBundledIndex(), model);
  return entry ? toDriveSpec(entry) : null;
}

export function specsNeedRefresh(
  specs: Pick<DriveSpec, "snapshot"> | null | undefined,
  previousModel: string | null | undefined,
  model: string | null | undefined,
): boolean {
  return previousModel !== model || specs?.snapshot !== DRIVE_DB_SNAPSHOT;
}

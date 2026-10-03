import type { EffectiveDiskState } from "#shared/disk";
import type { Interface, Media } from "#shared/hardware";
import type { DeviceStatus } from "#shared/smart/status";
import { LIFECYCLE_VOCABULARY } from "~/utils/vocabulary";
import type { InventoryDisk } from "./types";

export const ALL = "*";
export const NONE = "-";

export interface InventoryFilterState {
  search: string;
  host: string;
  pool: string;
  usage: string;
  purpose: string;
  media: string;
  interface: string;
  recording: string;
  vendor: string;
  states: EffectiveDiskState[];
  statuses: DeviceStatus[];
}

export const CLEARED_FILTERS: InventoryFilterState = {
  search: "",
  host: ALL,
  pool: ALL,
  usage: ALL,
  purpose: ALL,
  media: ALL,
  interface: ALL,
  recording: ALL,
  vendor: ALL,
  states: [],
  statuses: [],
};

export const MEDIA_OPTIONS = ["hdd", "ssd"] as const satisfies readonly Media[];

export const INTERFACE_OPTIONS = [
  "sata",
  "sas",
  "nvme",
  "usb",
] as const satisfies readonly Interface[];

export const RECORDING_OPTIONS = ["cmr", "smr"] as const;

export const LIFECYCLE_STATES = Object.keys(
  LIFECYCLE_VOCABULARY,
) as EffectiveDiskState[];

export const SINGLE_FACETS = [
  "host",
  "pool",
  "usage",
  "purpose",
  "media",
  "interface",
  "recording",
  "vendor",
] as const;

export const MULTI_FACETS = ["states", "statuses"] as const;

export type SingleFacet = (typeof SINGLE_FACETS)[number];
export type MultiFacet = (typeof MULTI_FACETS)[number];
export type Facet = SingleFacet | MultiFacet;

const FACETS: readonly Facet[] = [...SINGLE_FACETS, ...MULTI_FACETS];

const isMultiFacet = (facet: Facet): facet is MultiFacet =>
  (MULTI_FACETS as readonly Facet[]).includes(facet);

const knownOrNull = <Value extends string>(value: Value | null) =>
  value === "unknown" ? null : value;

const FACET_VALUE: Record<Facet, (disk: InventoryDisk) => string | null> = {
  host: (disk) => disk.hostName,
  pool: (disk) => disk.membership?.poolName ?? null,
  usage: (disk) => disk.usage.kind,
  purpose: (disk) => disk.purpose,
  media: (disk) => knownOrNull(disk.media),
  interface: (disk) => knownOrNull(disk.interface),
  recording: (disk) => knownRecordingTech(disk.recordingTech),
  vendor: (disk) => disk.vendor,
  states: (disk) => disk.state,
  statuses: (disk) => disk.latestStatus,
};

const facetKey = (facet: Facet, disk: InventoryDisk) =>
  FACET_VALUE[facet](disk) ?? NONE;

export const isFacetActive = (filters: InventoryFilterState, facet: Facet) =>
  isMultiFacet(facet) ? filters[facet].length > 0 : filters[facet] !== ALL;

export const isFiltered = (filters: InventoryFilterState) =>
  filters.search !== "" ||
  FACETS.some((facet) => isFacetActive(filters, facet));

const matchesFacet = (
  filters: InventoryFilterState,
  facet: Facet,
  disk: InventoryDisk,
) => {
  const key = facetKey(facet, disk);
  return isMultiFacet(facet)
    ? (filters[facet] as string[]).includes(key)
    : filters[facet] === key;
};

const matchesSearch = (needle: string, disk: InventoryDisk) =>
  !needle ||
  [disk.alias, disk.model, disk.serial].some((value) =>
    value?.toLowerCase().includes(needle),
  );

function filterDisksExcept(
  disks: InventoryDisk[],
  filters: InventoryFilterState,
  excluded?: Facet,
): InventoryDisk[] {
  const needle = filters.search.trim().toLowerCase();
  const active = FACETS.filter(
    (facet) => facet !== excluded && isFacetActive(filters, facet),
  );
  return disks.filter(
    (disk) =>
      matchesSearch(needle, disk) &&
      active.every((facet) => matchesFacet(filters, facet, disk)),
  );
}

export const filterDisks = (
  disks: InventoryDisk[],
  filters: InventoryFilterState,
) => filterDisksExcept(disks, filters);

export type FacetCounts = Record<Facet, ReadonlyMap<string, number>>;

/**
 * Per facet, how many disks each option would match given every other filter,
 * keyed by option value; `ALL` holds the facet's total, `NONE` the disks with
 * no value.
 */
export function facetCounts(
  disks: InventoryDisk[],
  filters: InventoryFilterState,
): FacetCounts {
  const countsFor = (facet: Facet) => {
    const candidates = filterDisksExcept(disks, filters, facet);
    const counts = new Map<string, number>([[ALL, candidates.length]]);
    for (const disk of candidates) {
      const key = facetKey(facet, disk);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  };
  const counts = {} as FacetCounts;
  for (const facet of FACETS) counts[facet] = countsFor(facet);
  return counts;
}

import { TEMPERATURE_DEFAULTS } from "#shared/temperature";
import type {
  TopologyDisk,
  TopologyVdev,
  TopologyVdevDisk,
} from "./groupDisks";

let nextId = 1;

export function vdevFixture(overrides: Partial<TopologyVdev>): TopologyVdev {
  const id = nextId++;
  return {
    id,
    guid: `guid-${id}`,
    name: `vdev-${id}`,
    type: "disk",
    state: "ONLINE",
    readErrors: 0,
    writeErrors: 0,
    checksumErrors: 0,
    slowIos: 0,
    path: null,
    sizeBytes: null,
    allocBytes: null,
    disk: null,
    children: [],
    ...overrides,
  };
}

export function vdevDiskFixture(
  id: number,
  alias: string,
  overrides: Partial<TopologyVdevDisk> = {},
): TopologyVdevDisk {
  return {
    id,
    alias,
    state: "in-use",
    latestStatus: "passed",
    capacityBytes: null,
    media: "hdd",
    purpose: null,
    latestTemp: null,
    modelShort: null,
    tempThresholds: TEMPERATURE_DEFAULTS.hdd,
    ...overrides,
  };
}

export function leafFixture(
  alias: string,
  diskId: number,
  overrides: Partial<TopologyVdev> = {},
): TopologyVdev {
  return vdevFixture({
    name: `/dev/disk/by-vdev/${alias}-part1`,
    path: `/dev/disk/by-vdev/${alias}-part1`,
    disk: vdevDiskFixture(diskId, alias),
    ...overrides,
  });
}

export function diskFixture(
  id: number,
  overrides: Partial<TopologyDisk> = {},
): TopologyDisk {
  return {
    id,
    alias: `D${id}`,
    model: null,
    serial: null,
    interfaceLabel: null,
    state: "in-use",
    stateOverride: null,
    purpose: null,
    media: null,
    latestStatus: "passed",
    capacityBytes: null,
    latestTemp: null,
    modelShort: null,
    tempThresholds: TEMPERATURE_DEFAULTS.hdd,
    present: false,
    lastSeenHostId: null,
    ...overrides,
  };
}

import {
  classifyInterface,
  classifyMedia,
  type HardwareJson,
  type Interface,
  type Media,
  resolveRecordingTech,
} from "#shared/hardware";
import type { disk } from "~~/server/database/schema";
import type { LsblkDisk } from "~~/server/ingest/lsblk";
import type { SmartctlXallResult } from "~~/server/ingest/smartctl-xall";

type DiskRow = typeof disk.$inferSelect;

export interface ObservedHardware {
  media?: Media;
  interface?: Interface;
  logicalBlockSize?: number;
  physicalBlockSize?: number;
  trimSupported?: boolean;
  hardware?: HardwareJson;
}

const known = <T extends string>(value: T) =>
  value === "unknown" ? undefined : value;

function hardwareJsonOf(
  identity: SmartctlXallResult["identity"],
): HardwareJson | undefined {
  const { linkSpeedMaxBps: maxBps, linkSpeedCurrentBps: currentBps } = identity;
  const hardware: HardwareJson = Object.fromEntries(
    Object.entries({
      sataVersion: identity.sataVersion,
      ataVersion: identity.ataVersion,
      nvmeVersion: identity.nvmeVersion,
      scsiTransport: identity.scsiTransport,
      deviceType: identity.deviceType,
      linkSpeed:
        maxBps !== undefined && currentBps !== undefined
          ? { maxBps, currentBps }
          : undefined,
    }).filter(([, value]) => value !== undefined),
  );
  return Object.keys(hardware).length > 0 ? hardware : undefined;
}

export function hardwareFromSmartctl({
  identity,
  device,
}: SmartctlXallResult): ObservedHardware {
  const input = {
    rotationRate: identity.rotationRate,
    protocol: device.protocol,
    deviceType: identity.deviceType,
    sataVersion: identity.sataVersion,
    scsiTransport: identity.scsiTransport,
  };
  return {
    media: known(classifyMedia(input)),
    interface: known(classifyInterface(input)),
    logicalBlockSize: identity.logicalBlockSize,
    physicalBlockSize: identity.physicalBlockSize,
    trimSupported: identity.trimSupported,
    hardware: hardwareJsonOf(identity),
  };
}

export function hardwareHintsFromLsblk(
  lsblkDisk: Pick<LsblkDisk, "rotational" | "link">,
): Pick<ObservedHardware, "media" | "interface"> {
  const input = { rotational: lsblkDisk.rotational, link: lsblkDisk.link };
  return {
    media: classifyMedia(input),
    interface: classifyInterface(input),
  };
}

export function recordingTechChanges(
  row: Pick<
    DiskRow,
    | "media"
    | "inventory"
    | "specs"
    | "modelFamily"
    | "trimSupported"
    | "recordingTech"
    | "hardware"
  >,
): Pick<DiskRow, "recordingTech" | "hardware"> | null {
  const { recordingTech, inferred } = resolveRecordingTech({
    media: row.media,
    override: row.inventory.recordingTech,
    datasetRecordingTech: row.specs?.recordingTech ?? null,
    modelFamily: row.modelFamily,
    trimSupported: row.trimSupported,
  });
  const { recordingTechInferred: _previous, ...rest } = row.hardware ?? {};
  const hardware: HardwareJson | null =
    inferred || row.hardware !== null
      ? { ...rest, ...(inferred ? { recordingTechInferred: true } : {}) }
      : null;
  const unchanged =
    recordingTech === row.recordingTech &&
    Boolean(row.hardware?.recordingTechInferred) === inferred;
  return unchanged ? null : { recordingTech, hardware };
}

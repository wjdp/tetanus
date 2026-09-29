import type { DriveSpec } from "#shared/drive-spec";
import {
  classifyInterface,
  classifyMedia,
  type HardwareJson,
  type Interface,
  isZonedSmr,
  type Media,
  resolveRecordingTech,
} from "#shared/hardware";
import { detectVendor } from "#shared/vendor";
import type { disk } from "~~/server/database/schema";
import type { LsblkDisk } from "~~/server/ingest/lsblk";
import type { SmartctlXallResult } from "~~/server/ingest/smartctl-xall";
import {
  lookupSpec,
  specsNeedRefresh,
} from "~~/server/services/drive-db/lookup";

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
  lsblkDisk: Pick<
    LsblkDisk,
    "rotational" | "link" | "logicalBlockSize" | "physicalBlockSize"
  >,
): Pick<
  ObservedHardware,
  "media" | "interface" | "logicalBlockSize" | "physicalBlockSize"
> {
  const input = { rotational: lsblkDisk.rotational, link: lsblkDisk.link };
  return {
    media: classifyMedia(input),
    interface: classifyInterface(input),
    logicalBlockSize: lsblkDisk.logicalBlockSize ?? undefined,
    physicalBlockSize: lsblkDisk.physicalBlockSize ?? undefined,
  };
}

export function zonedChanges(
  row: Pick<DiskRow, "hardware">,
  zoned: string | null,
): Pick<DiskRow, "hardware"> | null {
  const stored = row.hardware?.zoned;
  const observed = isZonedSmr(zoned) ? (zoned ?? undefined) : undefined;
  if (stored === observed) return null;
  const { zoned: _previous, ...rest } = row.hardware ?? {};
  return { hardware: { ...rest, ...(observed ? { zoned: observed } : {}) } };
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
    zoned: row.hardware?.zoned,
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

export interface SpecOverlap {
  rotationRate?: number;
  formFactor?: string;
  interface?: Interface;
  media?: Media;
}

export interface SpecReconciliation {
  filled: SpecOverlap;
  specMismatch: string[];
}

export function normaliseFormFactor(
  formFactor: string | null | undefined,
): string | null {
  const normalised = formFactor
    ?.trim()
    .replace(/\s*(?:inch(?:es)?|")$/i, "")
    .toUpperCase();
  return normalised || null;
}

const INCH_FORM_FACTORS = new Set(["3.5", "2.5", "1.8"]);

function formFactorAsObserved(formFactor: string): string {
  return INCH_FORM_FACTORS.has(formFactor)
    ? `${formFactor} inches`
    : formFactor;
}

type OverlapValue = string | number;

interface OverlapRule {
  datasetField: keyof DriveSpec;
  fromSpec: (spec: DriveSpec) => OverlapValue | undefined;
  comparable?: (value: OverlapValue) => OverlapValue | null;
}

const OVERLAP_RULES: Record<keyof SpecOverlap, OverlapRule> = {
  rotationRate: {
    datasetField: "rpm",
    fromSpec: (spec) => spec.rpm ?? undefined,
  },
  formFactor: {
    datasetField: "formFactor",
    fromSpec: (spec) =>
      spec.formFactor ? formFactorAsObserved(spec.formFactor) : undefined,
    comparable: (value) => normaliseFormFactor(String(value)),
  },
  interface: {
    datasetField: "interface",
    fromSpec: (spec) => specInterface(spec.interface),
  },
  media: {
    datasetField: "mediaType",
    fromSpec: (spec) => spec.mediaType,
  },
};

export function specInterface(
  driveInterface: DriveSpec["interface"],
): Interface | undefined {
  return driveInterface
    ? (driveInterface.toLowerCase() as Interface)
    : undefined;
}

const isObserved = <T>(value: T | null | undefined): value is T =>
  value !== undefined && value !== null && value !== "" && value !== "unknown";

export function reconcileWithSpec(
  observed: SpecOverlap,
  spec: DriveSpec | null,
): SpecReconciliation {
  const filled: Record<string, OverlapValue> = {};
  const specMismatch: string[] = [];
  for (const [field, rule] of Object.entries(OVERLAP_RULES)) {
    const observedValue = observed[field as keyof SpecOverlap];
    const datasetValue = spec ? rule.fromSpec(spec) : undefined;
    if (!isObserved(observedValue)) {
      if (isObserved(datasetValue)) filled[field] = datasetValue;
      continue;
    }
    filled[field] = observedValue;
    const comparable = rule.comparable ?? ((value: OverlapValue) => value);
    if (
      spec &&
      isObserved(datasetValue) &&
      comparable(observedValue) !== comparable(datasetValue)
    ) {
      specMismatch.push(
        `${field}: observed ${observedValue}, dataset ${spec[rule.datasetField]}`,
      );
    }
  }
  return { filled: filled as SpecOverlap, specMismatch };
}

export interface HardwareObservation extends ObservedHardware {
  model?: string | null;
  modelFamily?: string | null;
  rotationRate?: number | null;
  formFactor?: string | null;
  wwn?: string | null;
}

export type PreviousHardware = Pick<
  DiskRow,
  | "model"
  | "modelFamily"
  | "media"
  | "trimSupported"
  | "inventory"
  | "specs"
  | "hardware"
  | "vendor"
>;

export type DerivedHardware = Partial<
  Pick<
    DiskRow,
    | "rotationRate"
    | "formFactor"
    | "media"
    | "interface"
    | "specs"
    | "vendor"
    | "recordingTech"
    | "hardware"
  >
>;

const orNull = <T>(value: T | null | undefined): T | null =>
  isObserved(value) ? value : null;

function observedHardwareOf(hardware: HardwareJson | null | undefined) {
  const {
    recordingTechInferred: _inferred,
    specMismatch: _mismatch,
    zoned: _zoned,
    ...observed
  } = hardware ?? {};
  return observed;
}

function composeHardware(
  observed: HardwareJson,
  zoned: string | undefined,
  recordingTechInferred: boolean,
  specMismatch: string[],
): HardwareJson | null {
  const hardware: HardwareJson = {
    ...observed,
    ...(zoned ? { zoned } : {}),
    ...(recordingTechInferred ? { recordingTechInferred } : {}),
    ...(specMismatch.length > 0 ? { specMismatch } : {}),
  };
  return Object.keys(hardware).length > 0 ? hardware : null;
}

export function deriveHardware(
  previous: PreviousHardware | undefined,
  observation: HardwareObservation,
): DerivedHardware {
  const model = orNull(observation.model) ?? previous?.model ?? null;
  const modelFamily =
    orNull(observation.modelFamily) ?? previous?.modelFamily ?? null;
  const specs =
    previous && !specsNeedRefresh(previous.specs, previous.model, model)
      ? previous.specs
      : lookupSpec(model);
  const { filled, specMismatch } = reconcileWithSpec(
    {
      rotationRate: observation.rotationRate ?? undefined,
      formFactor: observation.formFactor ?? undefined,
      interface: observation.interface,
      media: observation.media,
    },
    specs,
  );
  const { recordingTech, inferred } = resolveRecordingTech({
    media: filled.media ?? previous?.media,
    override: previous?.inventory.recordingTech,
    datasetRecordingTech: specs?.recordingTech ?? null,
    modelFamily,
    trimSupported: observation.trimSupported ?? previous?.trimSupported,
    zoned: previous?.hardware?.zoned,
  });
  const vendor =
    detectVendor({
      model,
      wwn: observation.wwn,
      modelFamily,
      brand: specs?.brand,
    }) ??
    previous?.vendor ??
    null;
  return {
    ...filled,
    specs,
    vendor,
    recordingTech,
    hardware: composeHardware(
      observation.hardware ?? observedHardwareOf(previous?.hardware),
      previous?.hardware?.zoned,
      inferred,
      specMismatch,
    ),
  };
}

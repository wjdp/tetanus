export const MEDIA = ["hdd", "ssd", "unknown"] as const;
export type Media = (typeof MEDIA)[number];

export const INTERFACES = ["sata", "sas", "nvme", "usb", "unknown"] as const;
export type Interface = (typeof INTERFACES)[number];

export const RECORDING_TECHS = ["cmr", "smr", "unknown"] as const;
export type RecordingTech = (typeof RECORDING_TECHS)[number];

export const RECORDING_TECH_OVERRIDES = ["cmr", "smr"] as const;
export type RecordingTechOverride = (typeof RECORDING_TECH_OVERRIDES)[number];

export type SectorFormat = "512n" | "512e" | "4Kn";

export interface LinkSpeed {
  maxBps: number;
  currentBps: number;
}

export interface HardwareJson {
  sataVersion?: string;
  ataVersion?: string;
  nvmeVersion?: string;
  scsiTransport?: string;
  deviceType?: string;
  linkSpeed?: LinkSpeed;
  zoned?: string;
  recordingTechInferred?: boolean;
  specMismatch?: string[];
}

export interface ClassificationInput {
  rotationRate?: number | null;
  protocol?: string | null;
  deviceType?: string | null;
  sataVersion?: string | null;
  scsiTransport?: string | null;
  rotational?: boolean | null;
  link?: string | null;
}

const lower = (value: string | null | undefined) => value?.toLowerCase() ?? "";

export function classifyMedia(input: ClassificationInput): Media {
  const { rotationRate, rotational } = input;
  if (typeof rotationRate === "number" && rotationRate > 0) return "hdd";
  if (rotationRate === 0) return "ssd";
  if (lower(input.protocol) === "nvme") return "ssd";
  if (rotational === false) return "ssd";
  if (rotational === true) return "hdd";
  return "unknown";
}

const LINK_ONLY_INTERFACES: Partial<Record<string, Interface>> = {
  sata: "sata",
  nvme: "nvme",
};

export function classifyInterface(input: ClassificationInput): Interface {
  const protocol = lower(input.protocol);
  const link = lower(input.link);
  if (input.sataVersion || input.deviceType === "sat") return "sata";
  if (protocol === "nvme") return "nvme";
  if (protocol === "scsi" && /^sas\b/i.test(input.scsiTransport ?? "")) {
    return "sas";
  }
  if (link === "usb" && protocol === "ata") return "sata";
  if (protocol === "") return LINK_ONLY_INTERFACES[link] ?? "unknown";
  return "unknown";
}

const BUS_LABELS: Partial<Record<string, string>> = {
  sata: "SATA",
  sas: "SAS",
  nvme: "NVMe",
  usb: "USB",
};

const busLabel = (bus: string) => BUS_LABELS[bus] ?? bus.toUpperCase();

const isKnownBus = (bus: string | null | undefined): bus is string =>
  typeof bus === "string" && bus !== "" && bus !== "unknown";

export function interfaceLabel(
  driveInterface: Interface | null | undefined,
  link: string | null | undefined,
): string | null {
  const linkBus = lower(link);
  if (!isKnownBus(driveInterface)) {
    return isKnownBus(linkBus) ? busLabel(linkBus) : null;
  }
  if (isKnownBus(linkBus) && linkBus !== driveInterface) {
    return `${busLabel(driveInterface)} via ${busLabel(linkBus)}`;
  }
  return busLabel(driveInterface);
}

export function sectorFormat(
  logicalBlockSize: number | null | undefined,
  physicalBlockSize: number | null | undefined,
): SectorFormat | null {
  if (logicalBlockSize === 512 && physicalBlockSize === 512) return "512n";
  if (logicalBlockSize === 512 && physicalBlockSize === 4096) return "512e";
  if (logicalBlockSize === 4096 && physicalBlockSize === 4096) return "4Kn";
  return null;
}

export interface RecordingTechInput {
  media: Media | null | undefined;
  override?: RecordingTechOverride | null;
  datasetRecordingTech?: string | null;
  modelFamily?: string | null;
  trimSupported?: boolean | null;
  zoned?: string | null;
}

export interface RecordingTechResolution {
  recordingTech: RecordingTech | null;
  inferred: boolean;
}

const FAMILY_RECORDING_SUFFIX = /\((CMR|SMR)(?:\+[^)]*)?\)/i;

const ZONED_SMR_MODELS = new Set(["host-managed", "host-aware"]);

export function isZonedSmr(zoned: string | null | undefined): boolean {
  return ZONED_SMR_MODELS.has(lower(zoned) ?? "");
}

function asRecordingTech(value: string | null | undefined) {
  const normalised = lower(value);
  return normalised === "cmr" || normalised === "smr" ? normalised : null;
}

export function resolveRecordingTech(
  input: RecordingTechInput,
): RecordingTechResolution {
  if (input.media !== "hdd") return { recordingTech: null, inferred: false };
  const stated =
    asRecordingTech(input.override) ??
    (isZonedSmr(input.zoned) ? "smr" : null) ??
    asRecordingTech(input.datasetRecordingTech) ??
    asRecordingTech(input.modelFamily?.match(FAMILY_RECORDING_SUFFIX)?.[1]);
  if (stated) return { recordingTech: stated, inferred: false };
  if (input.trimSupported === true) {
    return { recordingTech: "smr", inferred: true };
  }
  return { recordingTech: "unknown", inferred: false };
}

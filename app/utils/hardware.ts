import type { DriveSpec } from "#shared/drive-spec";
import type { HardwareJson, Media, RecordingTech } from "#shared/hardware";
import type { Vendor } from "#shared/vendor";

export function mediaLabel(
  media: Media | null | undefined,
  rotationRate: number | null | undefined,
): string | null {
  if (media === "ssd") return "SSD";
  if (media !== "hdd") return null;
  return rotationRate ? `HDD ${rotationRate}` : "HDD";
}

const VENDOR_LABELS: Record<Vendor, string> = {
  seagate: "Seagate",
  "western-digital": "WD",
  toshiba: "Toshiba",
  samsung: "Samsung",
  intel: "Intel",
  hgst: "HGST",
  micron: "Micron",
  crucial: "Crucial",
  kingston: "Kingston",
  sandisk: "SanDisk",
  other: "Other",
};

export const vendorLabel = (vendor: Vendor | null | undefined) =>
  vendor ? VENDOR_LABELS[vendor] : null;

export function knownRecordingTech(
  recordingTech: RecordingTech | null | undefined,
): "cmr" | "smr" | null {
  return recordingTech === "cmr" || recordingTech === "smr"
    ? recordingTech
    : null;
}

export interface RecordingBadge {
  label: "CMR" | "SMR";
  color: "neutral" | "warning";
  variant: "subtle" | "outline";
  title?: string;
}

export function recordingBadge(disk: {
  recordingTech: RecordingTech | null;
  hardware: HardwareJson | null;
  membership: object | null;
}): RecordingBadge | null {
  const tech = knownRecordingTech(disk.recordingTech);
  if (!tech) return null;
  const inferred = disk.hardware?.recordingTechInferred === true;
  return {
    label: tech === "smr" ? "SMR" : "CMR",
    color: tech === "smr" && disk.membership ? "warning" : "neutral",
    variant: inferred ? "outline" : "subtle",
    title: inferred ? "Inferred from TRIM support" : undefined,
  };
}

const gigabitsPerSecond = (bps: number) => `${(bps / 1e9).toFixed(1)} Gb/s`;

export interface LinkSpeedDisplay {
  text: string;
  belowMax: boolean;
  title?: string;
}

export function linkSpeedDisplay(
  hardware: HardwareJson | null | undefined,
): LinkSpeedDisplay | null {
  const speed = hardware?.linkSpeed;
  if (!speed) return null;
  const belowMax = speed.currentBps < speed.maxBps;
  return {
    text: gigabitsPerSecond(speed.currentBps),
    belowMax,
    title: belowMax
      ? `negotiated below ${gigabitsPerSecond(speed.maxBps)} max`
      : undefined,
  };
}

function versionedBus(hardware: HardwareJson | null | undefined) {
  if (hardware?.sataVersion) return hardware.sataVersion;
  if (hardware?.nvmeVersion) return `NVMe ${hardware.nvmeVersion}`;
  return hardware?.scsiTransport ?? null;
}

export function interfaceDetail(
  label: string | null,
  hardware: HardwareJson | null | undefined,
): string | null {
  if (!label) return null;
  const version = versionedBus(hardware);
  const [bus = ""] = label.split(" ");
  if (!version?.toLowerCase().startsWith(bus.toLowerCase())) return label;
  return label.replace(bus, version);
}

export function mediaSummary(disk: {
  media: Media | null;
  rotationRate: number | null;
  recordingTech: RecordingTech | null;
  specs: DriveSpec | null;
}): string | null {
  const { specs } = disk;
  const parts =
    disk.media === "hdd"
      ? [
          "HDD",
          disk.rotationRate ? `${disk.rotationRate} rpm` : null,
          knownRecordingTech(disk.recordingTech)?.toUpperCase(),
          specs?.isHelium ? "helium" : null,
        ]
      : disk.media === "ssd"
        ? [
            "SSD",
            specs?.nandType,
            specs?.hasDram ? "DRAM" : null,
            specs?.hasPlp ? "PLP" : null,
          ]
        : [];
  const known = parts.filter(Boolean);
  return known.length > 0 ? known.join(" · ") : null;
}

import { createHash } from "node:crypto";
import type { DiskKey, DiskKeyKind } from "#shared/disk";
import type { LsblkDisk } from "~~/server/ingest/lsblk";
import type { SmartctlXallIdentity } from "~~/server/ingest/smartctl-xall";
import type { UdevResult } from "~~/server/ingest/udev";

export type DiskObservation =
  | { source: "smartctl-xall"; identity: SmartctlXallIdentity }
  | { source: "lsblk"; disk: LsblkDisk }
  | { source: "udev"; udev: UdevResult };

export interface ExistingDiskKey extends DiskKey {
  diskId: number;
}

export type DiskMatch = { diskId: number } | { conflict: number[] } | null;

const SCRUTINY_NAMESPACE = "3ea22b35-682b-49fb-a655-abffed108e48";
const INQUIRY_MODEL_LENGTH = 16;
const PARTITION_SUFFIX = /-part\d+$/;
// USB and SATA bridges report an all-zero or zero-OUI NAA WWN that identifies
// nothing and would merge every disk behind the same kind of bridge.
const PLACEHOLDER_WWN = /^(?:0+|5000000[0-9a-f]{9})$/;

export function normaliseWwn(wwn: string): string {
  return wwn.trim().replace(/^0x/i, "").toLowerCase();
}

function collapseSeparators(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/[\s_]+/g, "_");
}

// SCSI INQUIRY (lsblk on SAS HBAs, scsi-SATA_* by-id names) truncates the
// model to 16 characters, so every source is cut to the same length.
export function normaliseModelSerial(model: string, serial: string): string {
  const shortModel = collapseSeparators(model)
    .slice(0, INQUIRY_MODEL_LENGTH)
    .replace(/_+$/, "");
  const shortSerial = collapseSeparators(serial).replace(/^WD-/, "");
  return `${shortModel}|${shortSerial}`;
}

export function normaliseKey(kind: DiskKeyKind, value: string): string {
  switch (kind) {
    case "wwn":
      return normaliseWwn(value);
    case "model-serial": {
      const [model = "", serial = ""] = value.split("|");
      return normaliseModelSerial(model, serial);
    }
    default:
      return value.trim();
  }
}

export function isPlaceholderWwn(wwn: string): boolean {
  return PLACEHOLDER_WWN.test(normaliseWwn(wwn));
}

export function isPartitionName(name: string): boolean {
  return PARTITION_SUFFIX.test(name);
}

export function isUdevPartition(udev: UdevResult): boolean {
  return (
    udev.properties.DEVTYPE === "partition" ||
    udev.properties.ID_PART_ENTRY_NUMBER !== undefined
  );
}

function present(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function modelSerialKey(
  model: string | null | undefined,
  serial: string | null | undefined,
): DiskKey[] {
  if (!present(model) || !present(serial)) return [];
  return [{ kind: "model-serial", value: normaliseModelSerial(model, serial) }];
}

function wwnKey(wwn: string | null | undefined): DiskKey[] {
  return present(wwn) && !isPlaceholderWwn(wwn)
    ? [{ kind: "wwn", value: normaliseWwn(wwn) }]
    : [];
}

function placeholderWwnOf(udev: UdevResult): string | null {
  const wwn = udev.properties.ID_WWN;
  return present(wwn) && isPlaceholderWwn(wwn) ? normaliseWwn(wwn) : null;
}

// Behind a placeholder WWN, the bridge's SCSI model and serial are what udev
// shares with lsblk; ID_SERIAL and the scsi-3… and wwn-0x… names are built
// from the placeholder itself.
function bridgeKeys(udev: UdevResult, placeholder: string | null) {
  if (placeholder === null) return [];
  return modelSerialKey(
    udev.properties.ID_MODEL,
    udev.properties.ID_SCSI_SERIAL,
  );
}

function udevKeys(udev: UdevResult): DiskKey[] {
  if (isUdevPartition(udev)) return [];
  const placeholder = placeholderWwnOf(udev);
  const isDerived = (value: string) =>
    placeholder !== null && value.toLowerCase().includes(placeholder);
  const byId = udev.byId
    .filter((name) => !isPartitionName(name) && !isDerived(name))
    .map((value): DiskKey => ({ kind: "by-id", value }));
  const serial = udev.properties.ID_SERIAL;
  return [
    ...wwnKey(udev.properties.ID_WWN),
    ...bridgeKeys(udev, placeholder),
    ...(present(serial) && !isDerived(serial)
      ? [{ kind: "udev-serial" as const, value: serial.trim() }]
      : []),
    ...byId,
  ];
}

// lsblk reports udev's ID_SERIAL when a device has no ID_SERIAL_SHORT, which is
// the case for model-less devices such as SD cards (mmcblk).
function lsblkKeys({ serial, model, wwn }: LsblkDisk): DiskKey[] {
  if (!present(serial)) return [];
  if (!present(model) && !present(wwn)) {
    return [{ kind: "udev-serial", value: serial.trim() }];
  }
  return [...wwnKey(wwn), ...modelSerialKey(model, serial)];
}

function dedupeKeys(keys: DiskKey[]): DiskKey[] {
  const seen = new Set<string>();
  return keys.filter((key) => {
    const id = `${key.kind}\0${key.value}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export function extractKeys(observation: DiskObservation): DiskKey[] {
  switch (observation.source) {
    case "smartctl-xall":
      return dedupeKeys([
        ...wwnKey(observation.identity.wwn),
        ...modelSerialKey(
          observation.identity.model,
          observation.identity.serial,
        ),
      ]);
    case "lsblk":
      return dedupeKeys(lsblkKeys(observation.disk));
    case "udev":
      return dedupeKeys(udevKeys(observation.udev));
  }
}

const SCSI_SATA_TARGET = /^scsi-SATA_(.+)_([^_]+)$/;
const WWN_TARGET = /^wwn-(0x[0-9a-f]+)$/i;

// vdev_id.conf targets are by-id names; older scsi-SATA_<model>_<serial> and
// wwn-0x<hex> forms also resolve through the keys they encode.
export function keysFromVdevTarget(target: string): DiskKey[] {
  const name = target.slice(target.lastIndexOf("/") + 1);
  const keys: DiskKey[] = [{ kind: "by-id", value: name }];
  const wwn = WWN_TARGET.exec(name);
  if (wwn) keys.push(...wwnKey(wwn[1]));
  const scsiSata = SCSI_SATA_TARGET.exec(name);
  if (scsiSata) keys.push(...modelSerialKey(scsiSata[1], scsiSata[2]));
  return keys;
}

export function matchDisks(
  keys: DiskKey[],
  existing: ExistingDiskKey[],
): DiskMatch {
  const wanted = new Set(keys.map((key) => `${key.kind}\0${key.value}`));
  const diskIds = [
    ...new Set(
      existing
        .filter((key) => wanted.has(`${key.kind}\0${key.value}`))
        .map((key) => key.diskId),
    ),
  ].sort((a, b) => a - b);
  if (diskIds.length === 0) return null;
  if (diskIds.length === 1) return { diskId: diskIds[0] };
  return { conflict: diskIds };
}

function uuidV5(namespace: string, name: string): string {
  const hash = createHash("sha1")
    .update(Buffer.from(namespace.replaceAll("-", ""), "hex"))
    .update(name)
    .digest()
    .subarray(0, 16);
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

export function scrutinyWwn(wwn: string | null | undefined): string {
  return present(wwn) ? `0x${normaliseWwn(wwn)}` : "";
}

export function scrutinyUuid(
  model: string,
  serial: string,
  wwn: string | null | undefined,
): string {
  return uuidV5(SCRUTINY_NAMESPACE, model + serial + scrutinyWwn(wwn));
}

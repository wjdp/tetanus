export const DISK_STATES = [
  "in-use",
  "spare",
  "missing",
  "removed",
  "unseen",
] as const;
export type DiskState = (typeof DISK_STATES)[number];

export const STATE_OVERRIDES = ["spare", "removed", "dead", "retired"] as const;
export type StateOverride = (typeof STATE_OVERRIDES)[number];

export type EffectiveDiskState = DiskState | StateOverride;

export const HISTORY_STATES = [
  "dead",
  "retired",
] as const satisfies readonly StateOverride[];

export function isHistoryState(state: unknown): boolean {
  return (HISTORY_STATES as readonly unknown[]).includes(state);
}

export const DISPOSAL_KINDS = [
  "sold",
  "rma",
  "recycled",
  "given-away",
] as const;
export type DisposalKind = (typeof DISPOSAL_KINDS)[number];

export interface Disposal {
  kind: DisposalKind;
  on: string;
  salePrice?: number;
}

export function isDisposed(disk: { disposal: Disposal | null }): boolean {
  return disk.disposal !== null;
}

export const DISK_PROTOCOLS = ["ata", "nvme", "scsi", "unknown"] as const;
export type DiskProtocol = (typeof DISK_PROTOCOLS)[number];

export const DISK_KEY_KINDS = [
  "wwn",
  "model-serial",
  "udev-serial",
  "by-id",
] as const;
export type DiskKeyKind = (typeof DISK_KEY_KINDS)[number];

export interface DiskKey {
  kind: DiskKeyKind;
  value: string;
}

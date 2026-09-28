import metadata from "./metadata.json";

export type AttributeIdeal = "low" | "high" | "";
export type AtaDisplayType = "normalized" | "raw" | "transformed";
export type SmartProtocol = "ATA" | "NVMe" | "SCSI";

export interface ObservedThreshold {
  low: number;
  high: number;
  annualFailureRate: number;
}

export interface AttributeMetadata {
  displayName: string;
  ideal: AttributeIdeal;
  critical: boolean;
  description: string;
}

export interface AtaAttributeMetadata extends AttributeMetadata {
  displayType: AtaDisplayType;
  transformValueUnit?: string;
  observedThresholds?: ObservedThreshold[];
}

export const METADATA_SOURCE: string = metadata._source;

export const ATA_METADATA = metadata.ata as Readonly<
  Record<string, AtaAttributeMetadata>
>;
export const NVME_METADATA = metadata.nvme as Readonly<
  Record<string, AttributeMetadata>
>;
export const SCSI_METADATA = metadata.scsi as Readonly<
  Record<string, AttributeMetadata>
>;

const BY_PROTOCOL: Record<
  SmartProtocol,
  Readonly<Record<string, AttributeMetadata>>
> = {
  ATA: ATA_METADATA,
  NVMe: NVME_METADATA,
  SCSI: SCSI_METADATA,
};

export function attributeMetadata(
  protocol: "ATA",
  attrId: string | number,
): AtaAttributeMetadata | undefined;
export function attributeMetadata(
  protocol: SmartProtocol,
  attrId: string | number,
): AttributeMetadata | undefined;
export function attributeMetadata(
  protocol: SmartProtocol,
  attrId: string | number,
): AttributeMetadata | undefined {
  const table = BY_PROTOCOL[protocol];
  const key = String(attrId);
  return Object.hasOwn(table, key) ? table[key] : undefined;
}

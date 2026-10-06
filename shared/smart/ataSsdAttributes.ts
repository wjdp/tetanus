import type { Media } from "../hardware";
import type { SmartctlXallResult } from "../smartctl";
import type { Vendor } from "../vendor";
import { isAtaDefectAttribute, isAtaReservedSpaceAttribute } from "./ssdPolicy";
import { writtenUnit } from "./writtenBytes";

/** Normalised SATA SSD life attributes in preference order, by name since vendors reuse ids (Intel 233 is Total_LBAs_Written on some models). */
export const ATA_LIFE_REMAINING_ATTRIBUTES = [
  "Wear_Leveling_Count",
  "Media_Wearout_Indicator",
  "Percent_Life_Remaining",
  "SSD_Life_Left",
  "Percent_Lifetime_Remain",
] as const;

export const ATA_WRITTEN_ATTRIBUTE_ID = "241";

export interface AtaWrittenAttribute {
  attrId: string;
  unitBytes: number;
  inferred: boolean;
}

export interface AtaSsdAttributes {
  wear: string | null;
  written: AtaWrittenAttribute | null;
  /** Absent on rows stored before reserved-space matching. */
  reserved?: string[];
  /** Absent on rows stored before defect matching. */
  defects?: string[];
}

export interface AtaSsdDisk {
  media: Media | null;
  vendor: Vendor | null;
  logicalBlockSize: number | null;
}

export function isAtaLifeRemainingAttribute(name: string): boolean {
  return (ATA_LIFE_REMAINING_ATTRIBUTES as readonly string[]).includes(name);
}

export function ataSsdAttributesFrom(
  parsed: SmartctlXallResult,
  disk: AtaSsdDisk,
): AtaSsdAttributes | null {
  const attributes = parsed.ata?.attributes;
  if (disk.media !== "ssd" || !attributes) return null;
  const wear = ATA_LIFE_REMAINING_ATTRIBUTES.map((name) =>
    attributes.find((attribute) => attribute.name === name),
  ).find((attribute) => attribute !== undefined);
  const written = attributes.find(
    (attribute) => String(attribute.id) === ATA_WRITTEN_ATTRIBUTE_ID,
  );
  return {
    wear: wear ? String(wear.id) : null,
    written: written
      ? {
          attrId: ATA_WRITTEN_ATTRIBUTE_ID,
          ...writtenUnit(written.name, {
            vendor: disk.vendor,
            logicalBlockSize: disk.logicalBlockSize,
          }),
        }
      : null,
    reserved: attributes
      .filter((attribute) => isAtaReservedSpaceAttribute(attribute.name))
      .map((attribute) => String(attribute.id)),
    defects: attributes
      .filter((attribute) => isAtaDefectAttribute(attribute.name))
      .map((attribute) => String(attribute.id)),
  };
}

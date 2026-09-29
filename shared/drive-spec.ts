import { z } from "zod";

export const DRIVE_INTERFACES = ["SATA", "SAS", "NVMe"] as const;
export const DRIVE_FORM_FACTORS = ["3.5", "2.5", "M.2", "U.2", "U.3"] as const;
export const DRIVE_CLASSES = [
  "Desktop",
  "NAS",
  "NAS-Pro",
  "Enterprise",
  "Surveillance",
] as const;

export type DriveInterface = (typeof DRIVE_INTERFACES)[number];
export type DriveFormFactor = (typeof DRIVE_FORM_FACTORS)[number];
export type DriveClass = (typeof DRIVE_CLASSES)[number];
export type DriveSpecSource = "nasdisks" | "local";

const nullableNumber = z.number().nonnegative().nullable();

export const driveRecordSchema = z.strictObject({
  model: z.string().trim().min(1),
  brand: z.string().min(1),
  line: z.string().min(1).nullable(),
  capacity_tb: nullableNumber,
  rpm: nullableNumber,
  cache_mb: nullableNumber,
  interface: z.enum(DRIVE_INTERFACES).nullable(),
  form_factor: z.enum(DRIVE_FORM_FACTORS).nullable(),
  recording_tech: z.enum(["cmr", "smr", ""]).nullable(),
  erc_tler: z.boolean().nullable(),
  is_helium: z.boolean().nullable(),
  drive_class: z.enum(DRIVE_CLASSES).nullable(),
  media_type: z.enum(["hdd", "ssd"]),
  nand_type: z.string().min(1).nullable(),
  tbw_tb: nullableNumber,
  dwpd: nullableNumber,
  has_dram: z.boolean().nullable(),
  has_plp: z.boolean().nullable(),
  sustained_write_mbps: nullableNumber,
  in_production: z.boolean().nullable(),
  also_sold_as: z.array(z.string().trim().min(1)),
  afr_pct: nullableNumber,
  reliability_drive_count: nullableNumber,
  reliability_source: z.string().min(1).nullable(),
});

export type DriveRecord = z.infer<typeof driveRecordSchema>;

export const driveDbFileSchema = z.object({
  drives: z.array(driveRecordSchema),
});

export const driveSnapshotFileSchema = driveDbFileSchema.extend({
  source: z.literal("nasdisks"),
  snapshot: z.iso.date(),
});

export interface DriveSpec {
  source: DriveSpecSource;
  snapshot: string;
  matchedModel: string;
  model: string;
  brand: string;
  line: string | null;
  capacityTb: number | null;
  rpm: number | null;
  cacheMb: number | null;
  interface: DriveInterface | null;
  formFactor: DriveFormFactor | null;
  recordingTech: "cmr" | "smr" | null;
  ercTler: boolean | null;
  isHelium: boolean | null;
  driveClass: DriveClass | null;
  mediaType: "hdd" | "ssd";
  inProduction: boolean | null;
  alsoSoldAs: string[];
  nandType: string | null;
  tbwTb: number | null;
  dwpd: number | null;
  hasDram: boolean | null;
  hasPlp: boolean | null;
  sustainedWriteMbps: number | null;
  afrPct: number | null;
  reliabilityDriveCount: number | null;
  reliabilitySource: string | null;
}

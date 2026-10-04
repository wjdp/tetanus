import { z } from "zod";
import { type Media, RECORDING_TECH_OVERRIDES } from "./hardware";
import { PURPOSES } from "./usage";
import type { Vendor } from "./vendor";

export const INVENTORY_FIELDS = [
  {
    key: "purpose",
    label: "Purpose",
    type: "enum",
    values: PURPOSES,
    group: "placement",
    description:
      "Only needed when detection gets it wrong. System marks a boot or OS disk that was not spotted from its / or /boot mount. For anything else, such as scratch or backups, use tags.",
  },
  {
    key: "modelShort",
    label: "Display model",
    type: "text",
    group: "identity",
    description:
      "The short name topology tiles print. Usually left blank: it defaults to the product line from the spec dataset, or the model number. Set it only to override that.",
  },
  { key: "purchaseDate", label: "Purchased", type: "date" },
  { key: "purchasePrice", label: "Price", type: "money" },
  { key: "supplier", label: "Supplier", type: "text" },
  {
    key: "purchaseCondition",
    label: "Condition",
    type: "enum",
    values: ["new", "used", "refurbished", "shucked"],
  },
  { key: "warrantyExpiry", label: "Warranty", type: "date" },
  {
    key: "sellerWarrantyExpiry",
    label: "Seller warranty",
    type: "date",
    description:
      "Cover from the seller, separate from the manufacturer's: common on used and refurbished disks, sometimes added to new ones. The warranty countdown uses whichever ends later.",
  },
  {
    key: "orderRef",
    label: "Order ref",
    type: "text",
    description:
      "The order or invoice number, for proving the purchase in a warranty claim.",
  },
  { key: "tags", label: "Tags", type: "tags" },
  {
    key: "pin33Taped",
    label: "3.3 V pin",
    type: "boolean",
    when: ({ inventory }: FieldVisibilityContext) =>
      inventory.purchaseCondition === "shucked" || inventory.pin33Taped != null,
    description:
      "Shucked drives only: some external-enclosure drives will not power up in a standard bay until the 3.3 V power-disable pin is masked, usually with Kapton tape. Record whether this drive needed it.",
  },
  {
    key: "recordingTech",
    label: "Recording",
    type: "enum",
    values: RECORDING_TECH_OVERRIDES,
    media: ["hdd"],
    group: "hardware",
  },
  {
    key: "storageLocation",
    label: "Stored at",
    type: "text",
    group: "placement",
    suggest: true,
    when: ({ present, disposal }: FieldVisibilityContext) =>
      !present && !disposal,
    description:
      "Where the disk is kept while it is not plugged in: a drawer, a shelf, offsite. Hidden, not cleared, while the disk is in a host.",
  },
  {
    key: "shuckedFrom",
    label: "Shucked from",
    type: "text",
    group: "identity",
    suggest: true,
    when: ({ inventory }: FieldVisibilityContext) =>
      inventory.purchaseCondition === "shucked" ||
      Boolean(inventory.shuckedFrom),
    description:
      "The external drive this disk came out of, such as WD Elements 14 TB. Matters for warranty claims and for spotting batches.",
  },
  {
    key: "seagateBpid",
    label: "BPID",
    type: "text",
    group: "identity",
    when: ({ vendor, inventory }: FieldVisibilityContext) =>
      vendor === "seagate" || Boolean(inventory.seagateBpid),
    description:
      "Seagate only: the number printed on the drive label that Seagate's warranty checker and RMA form ask for. No command can read it, so copy it from the label once.",
  },
] as const;

type InventoryField = (typeof INVENTORY_FIELDS)[number];

export type InventoryFieldGroup =
  | "identity"
  | "hardware"
  | "placement"
  | "ownership";

export function fieldDescription(field: InventoryField): string | null {
  return "description" in field ? field.description : null;
}

export function suggestsFleetValues(field: InventoryField): boolean {
  return "suggest" in field && field.suggest;
}

export function fieldGroup(field: InventoryField): InventoryFieldGroup {
  return "group" in field ? field.group : "ownership";
}

interface VisibilityGate {
  media?: readonly Media[];
  vendors?: readonly Vendor[];
  when?: (context: FieldVisibilityContext) => boolean;
}

type GatedField = InventoryField & VisibilityGate;

export interface FieldVisibilityContext {
  media: Media | null;
  vendor: Vendor | null;
  inventory: Readonly<Record<string, unknown>>;
  present: boolean;
  disposal: unknown;
}

function passesGate(
  allowed: readonly string[] | undefined,
  value: string | null,
): boolean {
  return allowed === undefined || (value !== null && allowed.includes(value));
}

export function isFieldVisible(
  field: InventoryField,
  context: FieldVisibilityContext,
): boolean {
  const gate: GatedField = field;
  return (
    passesGate(gate.media, context.media) &&
    passesGate(gate.vendors, context.vendor) &&
    (gate.when?.(context) ?? true)
  );
}
export type InventoryFieldType = InventoryField["type"];
export type InventoryKey = InventoryField["key"];

interface ValueOfType {
  date: string;
  money: number;
  text: string;
  boolean: boolean;
  tags: string[];
}

type FieldValue<F extends InventoryField> = F extends {
  values: readonly (infer V)[];
}
  ? V
  : F["type"] extends keyof ValueOfType
    ? ValueOfType[F["type"]]
    : never;

export type Inventory = {
  [F in InventoryField as F["key"]]: FieldValue<F> | null;
};

const isoDate = z.iso.date();

export const TAG_PATTERN = /^[a-z0-9-]{1,32}$/;

export function normaliseTag(raw: string): string {
  return raw.trim().toLowerCase();
}

const tagList = z
  .array(z.string().transform(normaliseTag).pipe(z.string().regex(TAG_PATTERN)))
  .max(50)
  .transform((tags) => (tags.length ? [...new Set(tags)] : null));

function schemaFor(field: InventoryField): z.ZodType {
  switch (field.type) {
    case "date":
      return isoDate;
    case "money":
      return z.number().nonnegative();
    case "text":
      return z.string().trim().max(500);
    case "enum":
      return z.enum(field.values);
    case "boolean":
      return z.boolean();
    case "tags":
      return tagList;
  }
}

type InventoryShape = {
  [F in InventoryField as F["key"]]: z.ZodOptional<
    z.ZodNullable<z.ZodType<FieldValue<F>>>
  >;
};

export const inventorySchema = z.strictObject(
  Object.fromEntries(
    INVENTORY_FIELDS.map((field) => [
      field.key,
      schemaFor(field).nullable().optional(),
    ]),
  ) as InventoryShape,
);

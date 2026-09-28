import { z } from "zod";

export const INVENTORY_FIELDS = [
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
  { key: "pin33Taped", label: "3.3 V pin", type: "boolean" },
] as const;

type InventoryField = (typeof INVENTORY_FIELDS)[number];
export type InventoryFieldType = InventoryField["type"];
export type InventoryKey = InventoryField["key"];

interface ValueOfType {
  date: string;
  money: number;
  text: string;
  boolean: boolean;
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

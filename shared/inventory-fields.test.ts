import { describe, expect, it } from "vitest";
import {
  type FieldVisibilityContext,
  fieldGroup,
  INVENTORY_FIELDS,
  inventorySchema,
  isFieldVisible,
} from "./inventory-fields";

describe("inventorySchema", () => {
  it("has a rule for every registry field", () => {
    expect(Object.keys(inventorySchema.shape).sort()).toEqual(
      INVENTORY_FIELDS.map((field) => field.key).sort(),
    );
  });

  it("accepts a full inventory", () => {
    const inventory = {
      purchaseDate: "2023-04-01",
      purchasePrice: 189.99,
      supplier: "Scan",
      purchaseCondition: "shucked",
      warrantyExpiry: "2026-04-01",
      pin33Taped: true,
      recordingTech: "smr",
      seagateBpid: "1012345678",
    };
    expect(inventorySchema.parse(inventory)).toEqual(inventory);
  });

  it("accepts an empty inventory and explicit nulls", () => {
    expect(inventorySchema.parse({})).toEqual({});
    expect(inventorySchema.parse({ supplier: null })).toEqual({
      supplier: null,
    });
  });

  it("trims text", () => {
    expect(inventorySchema.parse({ supplier: "  Scan " })).toEqual({
      supplier: "Scan",
    });
  });

  it.each([
    { purchaseDate: "01/04/2023" },
    { purchaseDate: "2023-02-30" },
    { warrantyExpiry: "2026-04-01T00:00:00Z" },
    { purchasePrice: -1 },
    { purchasePrice: "189.99" },
    { purchaseCondition: "second-hand" },
    { pin33Taped: "yes" },
    { recordingTech: "unknown" },
    { colour: "blue" },
  ])("rejects %o", (inventory) => {
    expect(inventorySchema.safeParse(inventory).success).toBe(false);
  });
});

describe("isFieldVisible", () => {
  const field = (key: string) => {
    const found = INVENTORY_FIELDS.find((candidate) => candidate.key === key);
    if (!found) throw new Error(`${key} field missing`);
    return found;
  };
  const on = (
    media: FieldVisibilityContext["media"],
    vendor: FieldVisibilityContext["vendor"] = null,
    inventory: FieldVisibilityContext["inventory"] = {},
  ) => ({ media, vendor, inventory });

  it("shows recording tech only on hdds", () => {
    const recordingTech = field("recordingTech");
    expect(isFieldVisible(recordingTech, on("hdd"))).toBe(true);
    expect(isFieldVisible(recordingTech, on("hdd", "seagate"))).toBe(true);
    expect(isFieldVisible(recordingTech, on("ssd"))).toBe(false);
    expect(isFieldVisible(recordingTech, on("unknown"))).toBe(false);
    expect(isFieldVisible(recordingTech, on(null))).toBe(false);
  });

  it("shows ungated fields on every disk", () => {
    const supplier = field("supplier");
    expect(isFieldVisible(supplier, on("ssd"))).toBe(true);
    expect(isFieldVisible(supplier, on(null))).toBe(true);
  });

  it("shows the 3.3 V pin on shucked disks, or once recorded", () => {
    const pin = field("pin33Taped");
    expect(
      isFieldVisible(pin, on("hdd", null, { purchaseCondition: "shucked" })),
    ).toBe(true);
    expect(
      isFieldVisible(pin, on("hdd", null, { purchaseCondition: "new" })),
    ).toBe(false);
    expect(isFieldVisible(pin, on("hdd"))).toBe(false);
    expect(isFieldVisible(pin, on("hdd", null, { pin33Taped: false }))).toBe(
      true,
    );
  });

  it("shows the BPID on Seagate disks, or once recorded", () => {
    const bpid = field("seagateBpid");
    expect(isFieldVisible(bpid, on("hdd", "seagate"))).toBe(true);
    expect(isFieldVisible(bpid, on("hdd", "western-digital"))).toBe(false);
    expect(isFieldVisible(bpid, on("hdd", null))).toBe(false);
    expect(
      isFieldVisible(bpid, on("hdd", "other", { seagateBpid: "1012345678" })),
    ).toBe(true);
  });
});

describe("fieldGroup", () => {
  it("places purpose, display model and recording outside ownership", () => {
    expect(
      Object.fromEntries(
        INVENTORY_FIELDS.map((field) => [field.key, fieldGroup(field)]),
      ),
    ).toEqual({
      purpose: "placement",
      modelShort: "identity",
      purchaseDate: "ownership",
      purchasePrice: "ownership",
      supplier: "ownership",
      purchaseCondition: "ownership",
      warrantyExpiry: "ownership",
      pin33Taped: "ownership",
      recordingTech: "hardware",
      seagateBpid: "identity",
    });
  });
});

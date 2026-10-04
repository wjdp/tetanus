import { describe, expect, it } from "vitest";
import {
  needsBpid,
  type WarrantyCheckDisk,
  warrantyCheckUrl,
} from "./warranty-links";

const disk = (
  overrides: Partial<WarrantyCheckDisk> = {},
): WarrantyCheckDisk => ({
  vendor: "seagate",
  serial: "ZR5ABCDE",
  model: "ST18000NM000J-2TV103",
  inventory: {},
  ...overrides,
});

describe("warrantyCheckUrl", () => {
  it("gives Seagate the serial and the last four digits of the BPID", () => {
    expect(
      warrantyCheckUrl(disk({ inventory: { seagateBpid: "1004 526218" } })),
    ).toEqual({
      url: "https://www.seagate.com/gb/en/support/warranty-and-replacements/",
      copy: { Serial: "ZR5ABCDE", "BPID (last 4)": "6218" },
    });
  });

  it("leaves the BPID out until it is recorded", () => {
    expect(warrantyCheckUrl(disk())?.copy).toEqual({ Serial: "ZR5ABCDE" });
  });

  it("sends HGST disks to the WD checker", () => {
    expect(warrantyCheckUrl(disk({ vendor: "hgst" }))?.url).toBe(
      warrantyCheckUrl(disk({ vendor: "western-digital" }))?.url,
    );
  });

  it("gives Samsung the model and says there is no online checker", () => {
    const check = warrantyCheckUrl(
      disk({ vendor: "samsung", model: "Samsung SSD 850 EVO 500GB" }),
    );
    expect(check?.copy).toEqual({
      Serial: "ZR5ABCDE",
      Model: "Samsung SSD 850 EVO 500GB",
    });
    expect(check?.note).toMatch(/no online checker/);
  });

  it.each(["toshiba", "intel"] as const)(
    "links %s to its checker",
    (vendor) => {
      expect(warrantyCheckUrl(disk({ vendor }))?.url).toMatch(/^https:\/\//);
    },
  );

  it.each([
    ["no serial", disk({ serial: "  " })],
    ["an unknown vendor", disk({ vendor: null })],
    ["a vendor without a checker", disk({ vendor: "kingston" })],
  ])("is null for %s", (_case, input) => {
    expect(warrantyCheckUrl(input)).toBeNull();
  });
});

describe("needsBpid", () => {
  it("is true only for Seagate disks without a BPID", () => {
    expect(needsBpid(disk())).toBe(true);
    expect(needsBpid(disk({ inventory: { seagateBpid: "1004526218" } }))).toBe(
      false,
    );
    expect(needsBpid(disk({ vendor: "toshiba" }))).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import {
  bareModel,
  displayModel,
  modelWithoutVendor,
  resolveModelShort,
} from "./model";

describe("bareModel", () => {
  it.each([
    ["WDC WD120EMAZ-11BLFA0", "WD120EMAZ"],
    ["WDC WD120EDAZ-11F3RA0", "WD120EDAZ"],
    ["WDC WD120EMFZ-11A6JA0", "WD120EMFZ"],
    ["WDC WD120EDBZ-11B1HA0", "WD120EDBZ"],
    ["ST12000NM000J-2TY103", "ST12000NM000J"],
    ["ST16000NM001G-2KK103", "ST16000NM001G"],
    ["ST18000NM000J-2TV103", "ST18000NM000J"],
    ["TOSHIBA MG09ACA18TE", "MG09ACA18TE"],
    ["SAMSUNG MZ7KM480HMHQ-00005", "MZ7KM480HMHQ"],
    ["MZ7L37T6HBLA-00W07", "MZ7L37T6HBLA"],
    ["SSDSC2KG480G8R", "SSDSC2KG480G8R"],
    ["INTEL SSDSC2KG480G8", "SSDSC2KG480G8"],
    ["INTEL SSDSC2BB480G6R", "SSDSC2BB480G6R"],
    ["Samsung SSD 850 EVO 500GB", "850 EVO"],
    ["Samsung SSD 860 EVO 500GB", "860 EVO"],
    ["Samsung SSD 870 EVO 2TB", "870 EVO"],
    ["Samsung SSD 870 QVO 1.5 TB", "870 QVO"],
    ["WDS250G3X0C-00SJG0", "WDS250G3X0C"],
    ["HGST HUH721212ALE604", "HUH721212ALE604"],
    ["Hitachi HDS723030ALA640", "HDS723030ALA640"],
    ["KINGSTON SA400S37240G", "SA400S37240G"],
    ["CT1000MX500SSD1", "CT1000MX500SSD1"],
  ])("%s → %s", (input, expected) => {
    expect(bareModel(input)).toBe(expected);
  });

  it("matches vendor prefixes case-insensitively", () => {
    expect(bareModel("wdc WD80EFPX-68C4ZN0")).toBe("WD80EFPX");
    expect(bareModel("samsung ssd 870 EVO 4TB")).toBe("870 EVO");
  });

  it("trims and collapses whitespace", () => {
    expect(bareModel("  WDC   WD120EMAZ-11BLFA0  ")).toBe("WD120EMAZ");
  });

  it("keeps hyphenated part numbers that are not model-plus-variant", () => {
    expect(bareModel("HAT5320-24T")).toBe("HAT5320-24T");
    expect(bareModel("MZ-77Q8T0")).toBe("MZ-77Q8T0");
    expect(bareModel("SB-RKT4P-8TB")).toBe("SB-RKT4P-8TB");
    expect(bareModel("CSSD-F2000GBMP700ENH")).toBe("CSSD-F2000GBMP700ENH");
  });

  it("does not strip a capacity glued to the model code", () => {
    expect(bareModel("SA400S37240G")).toBe("SA400S37240G");
  });

  it.each([null, undefined, "", "   "])("returns null for %j", (input) => {
    expect(bareModel(input)).toBeNull();
  });
});

describe("modelWithoutVendor", () => {
  it("strips only the vendor prefix", () => {
    expect(modelWithoutVendor("WDC WD120EMAZ-11BLFA0")).toBe(
      "WD120EMAZ-11BLFA0",
    );
    expect(modelWithoutVendor("Samsung SSD 870 EVO 2TB")).toBe("870 EVO 2TB");
  });
});

describe("displayModel", () => {
  it.each([
    ["WDC WD120EMAZ-11BLFA0", "western-digital", "WD120EMAZ-11BLFA0"],
    ["WDC WD120EMAZ-11BLFA0", undefined, "WD120EMAZ-11BLFA0"],
    ["TOSHIBA MG09ACA18TE", "toshiba", "MG09ACA18TE"],
    ["Samsung SSD 870 EVO 2TB", "samsung", "870 EVO 2TB"],
    ["INTEL SSDSC2BB480G6R", null, "SSDSC2BB480G6R"],
    ["ST12000NM000J-2TY103", "seagate", "ST12000NM000J-2TY103"],
    ["WDC WD120EMAZ-11BLFA0", "seagate", "WDC WD120EMAZ-11BLFA0"],
  ] as const)("%s (%s) → %s", (input, vendor, expected) => {
    expect(displayModel(input, vendor)).toBe(expected);
  });

  it("returns null for blank input", () => {
    expect(displayModel(null)).toBeNull();
    expect(displayModel("  ")).toBeNull();
    expect(displayModel(undefined, "seagate")).toBeNull();
  });
});

describe("resolveModelShort", () => {
  const model = "ST18000NM000J-2TV103";

  it("prefers the inventory override", () => {
    expect(
      resolveModelShort(
        { modelShort: "Big Exos" },
        { line: "Exos X18" },
        model,
      ),
    ).toBe("Big Exos");
  });

  it("falls back to the drive-db line", () => {
    expect(
      resolveModelShort({ modelShort: null }, { line: "Exos X18" }, model),
    ).toBe("Exos X18");
    expect(
      resolveModelShort({ modelShort: "  " }, { line: "Exos X18" }, model),
    ).toBe("Exos X18");
  });

  it("falls back to the bare model", () => {
    expect(resolveModelShort(null, { line: null }, model)).toBe(
      "ST18000NM000J",
    );
    expect(resolveModelShort({}, null, model)).toBe("ST18000NM000J");
  });

  it("is null without a model", () => {
    expect(resolveModelShort(null, null, null)).toBeNull();
  });
});

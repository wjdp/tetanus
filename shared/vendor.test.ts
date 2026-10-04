import { describe, expect, it } from "vitest";
import { readFixture } from "../test/fixtures";
import { detectVendor, effectiveVendor, type Vendor } from "./vendor";

interface MarsDisk {
  model: string;
  wwn: string;
  modelFamily: string | null;
}

const MARS_DISK_LETTERS = "abcdefghijklmnopqrs".split("");

function marsDisk(letter: string): MarsDisk {
  const json = JSON.parse(
    readFixture(`mars/smartctl/xall-sd${letter}-auto.json`),
  );
  const { naa, oui, id } = json.wwn;
  return {
    model: json.model_name,
    wwn: `${naa.toString(16)}${oui.toString(16).padStart(6, "0")}${id.toString(16).padStart(9, "0")}`,
    modelFamily: json.model_family,
  };
}

const marsDisks = MARS_DISK_LETTERS.map(marsDisk);

const EXPECTED_BY_MODEL_PREFIX: [RegExp, Vendor][] = [
  [/^WDC /, "western-digital"],
  [/^ST/, "seagate"],
  [/^TOSHIBA /, "toshiba"],
  [/^(SAMSUNG|Samsung) /, "samsung"],
  [/^(SSDSC2|INTEL )/, "intel"],
];

function expectedVendor(model: string): Vendor {
  const match = EXPECTED_BY_MODEL_PREFIX.find(([prefix]) => prefix.test(model));
  if (!match) throw new Error(`no expectation for ${model}`);
  return match[1];
}

describe("detectVendor on mars", () => {
  it.each(marsDisks)("$model ($wwn) by model", ({ model }) => {
    expect(detectVendor({ model })).toBe(expectedVendor(model));
  });

  it.each(marsDisks)("$model ($wwn) by wwn alone", ({ model, wwn }) => {
    const vendor = detectVendor({ wwn });
    expect(vendor).not.toBeNull();
    if (!model.startsWith("WDC ")) expect(vendor).toBe(expectedVendor(model));
  });

  it("resolves WD white-label Ultrastars to hgst by wwn, western-digital by model", () => {
    const { model, wwn } = marsDisks[0] as MarsDisk;
    expect(detectVendor({ wwn })).toBe("hgst");
    expect(detectVendor({ model, wwn })).toBe("western-digital");
  });

  it.each(marsDisks.filter((disk) => disk.modelFamily))(
    "$model by family only",
    ({ model, modelFamily }) => {
      const vendor = detectVendor({ modelFamily });
      if (vendor) expect(vendor).toBe(expectedVendor(model));
    },
  );

  it("resolves a disk with a null model via wwn", () => {
    const seagate = marsDisks[5] as MarsDisk;
    expect(detectVendor({ model: null, wwn: seagate.wwn })).toBe("seagate");
  });
});

describe("detectVendor model prefixes", () => {
  it.each([
    ["ST12000NM000J-2TY103", "seagate"],
    ["WDC WD120EMAZ-11BLFA0", "western-digital"],
    ["WD80EFPX-68C4ZN0", "western-digital"],
    ["WDS250G3X0C-00SJG0", "western-digital"],
    ["TOSHIBA MG09ACA18TE", "toshiba"],
    ["Samsung SSD 870 EVO 2TB", "samsung"],
    ["SAMSUNG MZ7KM480HMHQ-00005", "samsung"],
    ["MZ7L37T6HBLA-00W07", "samsung"],
    ["INTEL SSDSC2BB480G6R", "intel"],
    ["SSDSC2KG480G8R", "intel"],
    ["SSDPE2KX010T8", "intel"],
    ["HGST HUH721212ALE604", "hgst"],
    ["Hitachi HDS723030ALA640", "hgst"],
    ["HUS726060ALE610", "hgst"],
    ["HUH721212ALE604", "hgst"],
    ["CT1000MX500SSD1", "crucial"],
    ["Micron_5300_MTFDDAK480TDS", "micron"],
    ["MTFDDAK480TDS", "micron"],
    ["KINGSTON SA400S37240G", "kingston"],
    ["SanDisk SDSSDH3 1T00", "sandisk"],
  ] as const)("%s → %s", (model, vendor) => {
    expect(detectVendor({ model })).toBe(vendor);
  });

  it.each([
    "STORAGE POOL",
    "STX",
    "CTRL-DISK",
    "CT",
    "WDCX",
    "WDIRECT",
    "MZ",
    "Mzansi",
    "INTELLIGENT DISK",
    "",
  ])("does not false-hit on %j", (model) => {
    expect(detectVendor({ model })).toBeNull();
  });
});

describe("detectVendor fallbacks", () => {
  it("falls back to wwn when the model is unrecognised", () => {
    expect(detectVendor({ model: "MYSTERY", wwn: "5000c500a1b2c3d4" })).toBe(
      "seagate",
    );
  });

  it("prefers model over wwn", () => {
    expect(
      detectVendor({ model: "TOSHIBA MG09ACA18TE", wwn: "5000c500a1b2c3d4" }),
    ).toBe("toshiba");
  });

  it("accepts 0x-prefixed and upper-case wwns", () => {
    expect(detectVendor({ wwn: "0x5000C500A1B2C3D4" })).toBe("seagate");
  });

  it.each(["5000c500a1b2c3", "not-a-wwn", "5ffffffa1b2c3d4e"])(
    "ignores wwn %s",
    (wwn) => {
      expect(detectVendor({ wwn })).toBeNull();
    },
  );

  it("falls back to model family", () => {
    expect(detectVendor({ modelFamily: "Western Digital Red (CMR)" })).toBe(
      "western-digital",
    );
    expect(detectVendor({ modelFamily: "Hitachi Deskstar" })).toBe("hgst");
    expect(
      detectVendor({ modelFamily: "Dell Certified Intel S4x00" }),
    ).toBeNull();
  });

  it("falls back to dataset brand, mapping unknown brands to other", () => {
    expect(detectVendor({ brand: "WD" })).toBe("western-digital");
    expect(detectVendor({ brand: "Seagate" })).toBe("seagate");
    expect(detectVendor({ brand: "Sabrent" })).toBe("other");
    expect(detectVendor({ brand: "Synology" })).toBe("other");
  });

  it("returns null with no evidence", () => {
    expect(detectVendor({})).toBeNull();
    expect(
      detectVendor({ model: null, wwn: null, modelFamily: null, brand: null }),
    ).toBeNull();
  });
});

describe("effectiveVendor", () => {
  it("prefers the override to the detected vendor", () => {
    expect(
      effectiveVendor({
        vendor: "other",
        inventory: { vendorOverride: "seagate" },
      }),
    ).toBe("seagate");
    expect(effectiveVendor({ vendor: "toshiba", inventory: {} })).toBe(
      "toshiba",
    );
    expect(
      effectiveVendor({ vendor: null, inventory: { vendorOverride: null } }),
    ).toBeNull();
  });
});

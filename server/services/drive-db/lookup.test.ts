import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { driveDbFileSchema, driveSnapshotFileSchema } from "#shared/drive-spec";
import {
  buildDriveIndex,
  DRIVE_DB_SNAPSHOT,
  findInIndex,
  lookupSpec,
  specsNeedRefresh,
} from "./lookup";
import snapshotFile from "./nasdisks.json";
import overridesFile from "./overrides.json";

describe("drive-db files", () => {
  it("snapshot validates against the record schema", () => {
    const snapshot = driveSnapshotFileSchema.parse(snapshotFile);
    expect(snapshot.snapshot).toBe(DRIVE_DB_SNAPSHOT);
    expect(snapshot.drives.length).toBeGreaterThan(200);
  });

  it("overrides validate and carry exactly the snapshot's fields", () => {
    const overrides = driveDbFileSchema.parse(overridesFile);
    const snapshotKeys = Object.keys(snapshotFile.drives[0]!).sort();
    for (const record of overridesFile.drives) {
      expect(Object.keys(record).sort()).toEqual(snapshotKeys);
    }
    expect(overrides.drives.length).toBeGreaterThan(0);
  });

  it("no override model is already in the snapshot", () => {
    const snapshotOnly = buildDriveIndex([
      {
        source: "nasdisks",
        drives: driveDbFileSchema.parse(snapshotFile).drives,
      },
    ]);
    const overlapping = overridesFile.drives
      .flatMap((record) => [record.model, ...record.also_sold_as])
      .filter((model) => findInIndex(snapshotOnly, model));
    expect(overlapping).toEqual([]);
  });
});

describe("lookupSpec", () => {
  it("hits the snapshot by exact bare model", () => {
    const spec = lookupSpec("ST12000NM000J-2TY103");
    expect(spec).toMatchObject({
      source: "nasdisks",
      snapshot: DRIVE_DB_SNAPSHOT,
      matchedModel: "ST12000NM000J",
      model: "ST12000NM000J",
      brand: "Seagate",
      line: "Exos X18",
      mediaType: "hdd",
    });
  });

  it("maps snake_case to camelCase and empty recording tech to null", () => {
    const spec = lookupSpec("TOSHIBA MG09ACA18TE");
    expect(spec?.capacityTb).toBe(18);
    expect(spec?.formFactor).toBe("3.5");
    expect(spec?.recordingTech).toBe("cmr");
    expect(lookupSpec("WDS200T1X0M")?.recordingTech).toBeNull();
  });

  it("finds rebadges through also_sold_as both ways", () => {
    expect(lookupSpec("ST16000NM002J")).toMatchObject({
      model: "ST16000NM000J",
      matchedModel: "ST16000NM002J",
    });
    expect(lookupSpec("ST16000NM000J-2TW103")?.matchedModel).toBe(
      "ST16000NM000J",
    );
  });

  it("matches dataset keys that keep a variant suffix", () => {
    expect(lookupSpec("SAMSUNG MZ7L37T6HBLA-00W07")?.line).toBe("PM893");
    expect(lookupSpec("MZ7L37T6HBLA-00A07")?.line).toBe("PM893");
  });

  it("keeps capacity-bearing part numbers distinct", () => {
    expect(lookupSpec("HAT5320-20T")?.capacityTb).toBe(20);
    expect(lookupSpec("HAT5320-24T")?.capacityTb).toBe(24);
  });

  it("resolves upstream placeholder keys through their listed variants", () => {
    expect(lookupSpec("TOSHIBA MG08ACA16TE")).toMatchObject({
      model: "MG08ACA16Tx",
      matchedModel: "MG08ACA16TE",
    });
  });

  it("is case-insensitive", () => {
    expect(lookupSpec("st12000nm000j")?.model).toBe("ST12000NM000J");
  });

  it("prefers local overrides", () => {
    expect(lookupSpec("WDC WD120EMAZ-11BLFA0")).toMatchObject({
      source: "local",
      snapshot: DRIVE_DB_SNAPSHOT,
      matchedModel: "WD120EMAZ",
      isHelium: true,
    });
    expect(lookupSpec("WDC WD120EDAZ-11F3RA0")?.matchedModel).toBe("WD120EDAZ");
    expect(lookupSpec("Samsung SSD 870 EVO 2TB")).toMatchObject({
      source: "local",
      matchedModel: "870 EVO",
      nandType: "TLC",
    });
  });

  it("returns null for unknown or missing models", () => {
    expect(lookupSpec("NOTADRIVE123")).toBeNull();
    expect(lookupSpec(null)).toBeNull();
    expect(lookupSpec("")).toBeNull();
  });
});

describe("mars coverage", () => {
  const smartctl = join(process.cwd(), "test/fixtures/mars/smartctl");
  const models = readdirSync(smartctl)
    .filter((file) => file.endsWith("-auto.json") || file === "xall-nvme0.json")
    .map(
      (file) =>
        JSON.parse(readFileSync(join(smartctl, file), "utf8")).model_name,
    );

  it("finds a spec for every mars disk", () => {
    expect(models.filter((model) => !lookupSpec(model))).toEqual([]);
  });
});

describe("specsNeedRefresh", () => {
  it("refreshes when the model or snapshot changes, or nothing matched", () => {
    const current = { snapshot: DRIVE_DB_SNAPSHOT };
    expect(specsNeedRefresh(current, "A", "A")).toBe(false);
    expect(specsNeedRefresh(current, "A", "B")).toBe(true);
    expect(specsNeedRefresh({ snapshot: "2000-01-01" }, "A", "A")).toBe(true);
    expect(specsNeedRefresh(null, "A", "A")).toBe(true);
  });
});

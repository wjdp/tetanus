import { describe, expect, it } from "vitest";
import {
  defaultBayLabel,
  defaultPathLabel,
  locationKeyOf,
  parseEnclosureKey,
} from "./bays";

describe("defaultPathLabel", () => {
  it.each([
    ["pci-0000:06:00.1-ata-5", "SATA port 5"],
    ["pci-0000:06:00.1-ata-5.0", "SATA port 5"],
    ["pci-0000:26:00.0-sas-exp0x5001e677a1a113f0-phy8-lun-0", "SAS phy 8"],
    ["pci-0000:01:00.0-sas-phy5-lun-0", "SAS phy 5"],
    ["pci-0000:01:00.0-nvme-1", "NVMe 01:00.0"],
    [
      "pci-0000:00:14.0-usb-0:3:1.0-scsi-0:0:0:0",
      "USB pci-0000:00:14.0-usb-0:3:1.0-scsi-0:0:0:0",
    ],
    ["platform-ahci", "platform-ahci"],
  ])("%s → %s", (idPath, label) => {
    expect(defaultPathLabel(idPath)).toBe(label);
  });
});

describe("location keys", () => {
  it("prefers the slot over the path", () => {
    expect(locationKeyOf({ enclosureId: "5001", slot: 8 }, "pci-x")).toBe(
      "enc:5001:8",
    );
    expect(locationKeyOf(null, "pci-x")).toBe("path:pci-x");
    expect(locationKeyOf(null, null)).toBeNull();
  });

  it("parses enclosure keys only", () => {
    expect(parseEnclosureKey("enc:5001:8")).toEqual({
      enclosureId: "5001",
      slot: 8,
    });
    expect(parseEnclosureKey("path:pci-0000:01:00.0-nvme-1")).toBeNull();
  });

  it("defaults a slot to its enclosure's model", () => {
    const models = new Map([["5001", "RES2SV240"]]);
    expect(defaultBayLabel("enc:5001:8", models)).toBe("RES2SV240 slot 8");
    expect(defaultBayLabel("enc:9999:3", models)).toBe("Enclosure slot 3");
    expect(defaultBayLabel("path:pci-0000:06:00.1-ata-6")).toBe("SATA port 6");
  });
});

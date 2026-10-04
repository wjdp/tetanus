import { describe, expect, it } from "vitest";
import { fleetSuggestions } from "./fleetSuggestions";

describe("fleetSuggestions", () => {
  it("collects distinct values in use, sorted", () => {
    const disks = [
      { inventory: { storageLocation: "drawer" } },
      { inventory: { storageLocation: " offsite " } },
      { inventory: { storageLocation: "drawer" } },
      { inventory: { storageLocation: "" } },
      { inventory: {} },
    ];
    expect(fleetSuggestions(disks, "storageLocation")).toEqual([
      "drawer",
      "offsite",
    ]);
  });

  it("flattens tags", () => {
    const disks = [
      { inventory: { tags: ["spare", "cold-backup"] } },
      { inventory: { tags: ["spare"] } },
    ];
    expect(fleetSuggestions(disks, "tags")).toEqual(["cold-backup", "spare"]);
  });
});

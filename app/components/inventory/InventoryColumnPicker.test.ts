// @vitest-environment nuxt

import { mountSuspended } from "@nuxt/test-utils/runtime";
import type { DropdownMenuItem } from "@nuxt/ui";
import { describe, expect, it } from "vitest";
import InventoryColumnPicker from "./InventoryColumnPicker.vue";

const mountPicker = (customised = false) =>
  mountSuspended(InventoryColumnPicker, {
    props: { visibleColumns: new Set(["alias", "model"]), customised },
  });

const menuItems = async (customised = false) => {
  const picker = await mountPicker(customised);
  return {
    picker,
    groups: picker
      .getComponent({ name: "UDropdownMenu" })
      .props("items") as DropdownMenuItem[][],
  };
};

describe("InventoryColumnPicker", () => {
  it("lists hideable columns under their group labels, without alias", async () => {
    const { groups } = await menuItems();
    const labels = groups.map((group) => group.map(({ label }) => label));

    expect(labels[0]).toEqual(["Identity", "Model", "Vendor"]);
    expect(labels.map((group) => group[0])).toEqual([
      "Identity",
      "Hardware",
      "Placement",
      "Health",
      "Inventory",
      "Reset to default",
    ]);
    expect(labels.flat()).not.toContain("Alias");
  });

  it("checks visible columns, keeps the menu open and reports toggles", async () => {
    const { picker, groups } = await menuItems();
    const [model, vendor] = groups[0].slice(1);
    const event = new Event("select", { cancelable: true });

    expect(model.checked).toBe(true);
    expect(vendor.checked).toBe(false);
    vendor.onSelect?.(event);
    expect(event.defaultPrevented).toBe(true);
    vendor.onUpdateChecked?.(true);
    expect(picker.emitted("toggle")).toEqual([["vendor", true]]);
  });

  it("offers reset only once customised", async () => {
    expect((await menuItems(false)).groups.at(-1)?.[0].disabled).toBe(true);
    const { picker, groups } = await menuItems(true);
    const reset = groups.at(-1)?.[0];

    expect(reset?.disabled).toBe(false);
    reset?.onSelect?.(new Event("select"));
    expect(picker.emitted("reset")).toHaveLength(1);
  });
});

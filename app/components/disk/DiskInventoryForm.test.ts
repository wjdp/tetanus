// @vitest-environment nuxt
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { describe, expect, it } from "vitest";
import DiskInventoryForm from "./DiskInventoryForm.vue";
import type { DiskDetail } from "./types";

const mountForm = (inventory: Record<string, unknown>, line: string | null) =>
  mountSuspended(DiskInventoryForm, {
    props: {
      disk: {
        id: 7,
        alias: null,
        notes: "",
        media: "hdd",
        vendor: "seagate",
        inventory,
        ageDays: null,
        warrantyDaysLeft: null,
        specs: line ? { line } : null,
      } as unknown as DiskDetail,
    },
  });

const suggestion = '[data-testid="warranty-suggestion"]';

describe("DiskInventoryForm warranty hint", () => {
  it("offers the line default and applies it to the draft on request", async () => {
    const form = await mountForm({ purchaseDate: "2023-04-01" }, "Exos X18");

    expect(form.get(suggestion).text()).toContain(
      "5 y from purchase → 2028-04-01 (Exos X18 default)",
    );
    const warranty = form.get('input[name="warrantyExpiry"]');
    expect((warranty.element as HTMLInputElement).value).toBe("");

    await form.get(`${suggestion} button`).trigger("click");

    expect((warranty.element as HTMLInputElement).value).toBe("2028-04-01");
    expect(form.find(suggestion).exists()).toBe(false);
  });

  it("shows no hint without a spec line", async () => {
    const form = await mountForm({ purchaseDate: "2023-04-01" }, null);

    expect(form.find(suggestion).exists()).toBe(false);
  });
});

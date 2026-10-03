// @vitest-environment nuxt
import { mountSuspended, registerEndpoint } from "@nuxt/test-utils/runtime";
import { flushPromises } from "@vue/test-utils";
import { beforeEach, describe, expect, it } from "vitest";
import { clearNuxtData } from "#app";
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

let currency = "GBP";
registerEndpoint("/api/settings", () => ({
  enrolToken: "x",
  config: { currency },
}));

beforeEach(() => {
  clearNuxtData();
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

describe("DiskInventoryForm price", () => {
  it.each([
    ["GBP", "£", "0.01"],
    ["USD", "$", "0.01"],
    ["JPY", "¥", "1"],
  ])("follows the %s setting", async (code, symbol, step) => {
    currency = code;
    const form = await mountForm({ purchasePrice: 100 }, null);
    await flushPromises();

    expect(form.get('[data-testid="currency-symbol"]').text()).toBe(symbol);
    expect(form.get('input[name="purchasePrice"]').attributes("step")).toBe(
      step,
    );
  });
});

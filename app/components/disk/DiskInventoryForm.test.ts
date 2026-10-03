// @vitest-environment nuxt
import { mountSuspended, registerEndpoint } from "@nuxt/test-utils/runtime";
import { flushPromises } from "@vue/test-utils";
import { readBody } from "h3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearNuxtData } from "#app";
import DiskInventoryForm, {
  type ReplacementCandidate,
} from "./DiskInventoryForm.vue";
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

describe("DiskInventoryForm replaces", () => {
  const patched = vi.fn();
  registerEndpoint("/api/disks/7", {
    method: "PATCH",
    handler: async (event) => {
      patched(await readBody(event));
      return { id: 7 };
    },
  });

  const candidate = (overrides: Partial<ReplacementCandidate>) => ({
    id: 1,
    alias: null,
    serial: null,
    hostName: null,
    purpose: null,
    disposal: null,
    replacedByDiskId: null,
    inventory: {},
    ...overrides,
  });

  const rma = { kind: "rma", on: "2026-10-02" } as const;

  const DISKS = [
    candidate({
      id: 4,
      alias: "K1",
      disposal: rma,
      inventory: { warrantyExpiry: "2027-05-01" },
    }),
    candidate({ id: 5, alias: "K3", disposal: rma, replacedByDiskId: 9 }),
    candidate({
      id: 6,
      alias: "K4",
      disposal: { kind: "sold", on: "2026-09-01" },
    }),
    candidate({ id: 7, alias: "K7" }),
  ];

  const mountWith = (replacesDiskId: number | null) =>
    mountSuspended(DiskInventoryForm, {
      props: {
        disk: {
          id: 7,
          alias: "K7",
          notes: "",
          media: "hdd",
          vendor: "seagate",
          inventory: {},
          ageDays: null,
          warrantyDaysLeft: null,
          specs: null,
          replacesDiskId,
        } as unknown as DiskDetail,
        disks: DISKS,
      },
      attachTo: document.body,
    });

  it("lists RMA'd disks not yet replaced", async () => {
    const form = await mountWith(null);

    await form.get('button[aria-label="Replaces"]').trigger("keydown", {
      key: "Enter",
    });
    await flushPromises();

    expect(
      [...document.body.querySelectorAll('[role="option"]')].map((option) =>
        option.textContent?.trim(),
      ),
    ).toEqual(["—", "K1"]);
    form.unmount();
  });

  it("offers the replaced disk's warranty and saves the link", async () => {
    const form = await mountWith(4);
    const copy = '[data-testid="warranty-copy"]';

    expect(form.get(copy).text()).toBe("Copy warranty from K1");
    await form.get(`${copy} button`).trigger("click");

    expect(
      (form.get('input[name="warrantyExpiry"]').element as HTMLInputElement)
        .value,
    ).toBe("2027-05-01");
    expect(form.find(copy).exists()).toBe(false);

    await form.get("form").trigger("submit");
    await vi.waitFor(() =>
      expect(patched).toHaveBeenCalledWith(
        expect.objectContaining({
          replacesDiskId: 4,
          inventory: expect.objectContaining({ warrantyExpiry: "2027-05-01" }),
        }),
      ),
    );
    form.unmount();
  });
});

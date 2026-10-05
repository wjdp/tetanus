// @vitest-environment nuxt
import { mountSuspended, registerEndpoint } from "@nuxt/test-utils/runtime";
import { flushPromises } from "@vue/test-utils";
import { readBody } from "h3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearNuxtData } from "#app";
import SettingsPage from "./index.vue";

const enrolToken = "ab".repeat(32);

const THRESHOLDS = {
  replicationLateFloorHours: 3,
  replicationLateFactor: 0.5,
  replicationStalledFloorHours: 48,
  replicationStalledFactor: 2,
};

registerEndpoint("/api/settings", () => ({
  enrolToken,
  config: { missingAfterDays: 7, currency: "GBP", ...THRESHOLDS },
}));

const patched: unknown[] = [];
registerEndpoint("/api/settings", {
  method: "PATCH",
  handler: async (event) => {
    const body = await readBody(event);
    patched.push(body);
    return {
      enrolToken,
      config: { missingAfterDays: 7, ...THRESHOLDS, ...body.config },
    };
  },
});

beforeEach(() => {
  clearNuxtData();
  patched.length = 0;
});

describe("settings page", () => {
  it("shows the enrol token", async () => {
    const page = await mountSuspended(SettingsPage);
    const input = page.get('input[data-testid="enrol-token"]');
    expect((input.element as HTMLInputElement).value).toBe(enrolToken);
  });

  it("copies the enrol token", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    const page = await mountSuspended(SettingsPage);

    await page.get('button[aria-label="Copy enrol token"]').trigger("click");

    expect(writeText).toHaveBeenCalledWith(enrolToken);
  });
});

describe("settings page currency", () => {
  it("patches the currency when one is chosen", async () => {
    const page = await mountSuspended(SettingsPage);
    const select = page.findComponent({ name: "USelectMenu" });

    select.vm.$emit("update:modelValue", "EUR");
    await flushPromises();

    expect(patched).toEqual([{ config: { currency: "EUR" } }]);
    await vi.waitFor(() =>
      expect(page.get('[data-testid="currency"]').text()).toContain("EUR"),
    );
  });
});

describe("settings page replication thresholds", () => {
  it("shows the four thresholds and patches them together", async () => {
    const page = await mountSuspended(SettingsPage);
    const form = page.get('[data-testid="replication-thresholds"]');
    const inputs = form.findAll("input");

    expect(
      inputs.map((input) => (input.element as HTMLInputElement).value),
    ).toEqual(["3", "0.5", "48", "2"]);

    await inputs[0].setValue("6");
    await form.trigger("submit");
    await flushPromises();

    expect(patched).toEqual([
      { config: { ...THRESHOLDS, replicationLateFloorHours: 6 } },
    ]);
  });
});

describe("settings page in the demo", () => {
  beforeEach(() => {
    useRuntimeConfig().public.demo = true;
  });

  afterEach(() => {
    useRuntimeConfig().public.demo = false;
  });

  it("hides the enrol token", async () => {
    const page = await mountSuspended(SettingsPage);
    expect(page.find('input[data-testid="enrol-token"]').exists()).toBe(false);
    expect(page.text()).not.toContain(enrolToken);
  });
});

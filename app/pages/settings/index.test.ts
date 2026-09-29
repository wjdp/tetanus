// @vitest-environment nuxt
import { mountSuspended, registerEndpoint } from "@nuxt/test-utils/runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SettingsPage from "./index.vue";

const enrolToken = "ab".repeat(32);

registerEndpoint("/api/settings", () => ({
  enrolToken,
  config: { missingAfterDays: 7 },
}));

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

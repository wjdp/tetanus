// @vitest-environment nuxt
import { mountSuspended, registerEndpoint } from "@nuxt/test-utils/runtime";
import { flushPromises } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearNuxtData } from "#app";
import { FULL_SMART_DAYS, RETENTION_RULES } from "#shared/retention";
import DatabasePage from "./database.vue";

let databaseBytes = 3_000_000;
registerEndpoint("/api/database", () => ({
  bytes: databaseBytes,
  reclaimableBytes: databaseBytes - 1_000_000,
}));

let optimised = 0;
registerEndpoint("/api/database/optimise", {
  method: "POST",
  handler: () => {
    optimised += 1;
    databaseBytes = 1_000_000;
    return {
      before: { bytes: 3_000_000, reclaimableBytes: 2_000_000 },
      after: { bytes: 1_000_000, reclaimableBytes: 0 },
    };
  },
});

beforeEach(() => {
  clearNuxtData();
  databaseBytes = 3_000_000;
  optimised = 0;
});

describe("database settings", () => {
  it("shows the size and optimises on click", async () => {
    const page = await mountSuspended(DatabasePage);
    expect(page.get('[data-testid="database-size"]').text()).toBe(
      "3.00 MB, 2.00 MB reclaimable",
    );

    await page.get('[data-testid="optimise-database"]').trigger("click");
    await flushPromises();

    expect(optimised).toBe(1);
    await vi.waitFor(() =>
      expect(page.get('[data-testid="database-size"]').text()).toBe(
        "1.00 MB, 0 B reclaimable",
      ),
    );
  });

  it("lists every retention rule with its period", async () => {
    const page = await mountSuspended(DatabasePage);
    const rules = page.get('[data-testid="retention-rules"]');
    expect(rules.findAll("dt")).toHaveLength(RETENTION_RULES.length);
    expect(rules.text()).toContain(
      `Every reading for ${FULL_SMART_DAYS} days, then each disk's last reading of the day, forever.`,
    );
  });
});

describe("database settings in the demo", () => {
  beforeEach(() => {
    useRuntimeConfig().public.demo = true;
  });

  afterEach(() => {
    useRuntimeConfig().public.demo = false;
  });

  it("hides maintenance and says retention does not run", async () => {
    const page = await mountSuspended(DatabasePage);
    expect(page.find('[data-testid="optimise-database"]').exists()).toBe(false);
    expect(page.text()).toContain("Retention does not run in the demo");
  });
});

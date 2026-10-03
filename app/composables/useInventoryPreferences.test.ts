// @vitest-environment nuxt
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { beforeEach, describe, expect, it } from "vitest";
import { defineComponent, h, nextTick } from "vue";
import { DEFAULT_VISIBLE_COLUMNS } from "~/components/inventory/columns";
import { clearCookie, writeCookie } from "~~/test/cookies";
import {
  INVENTORY_PREFERENCES_COOKIE,
  useInventoryPreferences,
} from "./useInventoryPreferences";

const storeRaw = (raw: string) =>
  writeCookie(INVENTORY_PREFERENCES_COOKIE, raw);

const readCookie = async () => {
  await nextTick();
  const entry = document.cookie
    .split("; ")
    .find((cookie) => cookie.startsWith(`${INVENTORY_PREFERENCES_COOKIE}=`));
  return entry
    ? JSON.parse(decodeURIComponent(entry.split("=").slice(1).join("=")))
    : undefined;
};

const mountPreferences = async () => {
  let preferences!: ReturnType<typeof useInventoryPreferences>;
  await mountSuspended(
    defineComponent({
      setup() {
        preferences = useInventoryPreferences();
        return () => h("div");
      },
    }),
  );
  return preferences;
};

const sorted = (ids: Iterable<string>) => [...ids].sort();

beforeEach(() => {
  clearCookie(INVENTORY_PREFERENCES_COOKIE);
});

describe("useInventoryPreferences", () => {
  it("defaults to the registry's visible columns and the table view", async () => {
    const preferences = await mountPreferences();

    expect(sorted(preferences.visibleColumns.value)).toEqual(
      sorted(DEFAULT_VISIBLE_COLUMNS),
    );
    expect(preferences.view.value).toBe("table");
    expect(preferences.isCustomised.value).toBe(false);
  });

  it("merges stored overrides over the defaults", async () => {
    storeRaw(JSON.stringify({ columns: { sectors: true, host: false } }));
    const preferences = await mountPreferences();
    const visible = preferences.visibleColumns.value;

    expect(visible.has("sectors")).toBe(true);
    expect(visible.has("host")).toBe(false);
    expect(visible.has("model")).toBe(true);
    expect(visible.has("vendor")).toBe(false);
  });

  it("drops unknown and locked ids", async () => {
    storeRaw(JSON.stringify({ columns: { gone: true, alias: false } }));
    const preferences = await mountPreferences();

    expect(preferences.visibleColumns.value.has("alias")).toBe(true);
    expect(preferences.visibleColumns.value.has("gone")).toBe(false);
    expect(preferences.isCustomised.value).toBe(false);
  });

  it.each([
    "not json",
    "[1,2]",
    JSON.stringify({ columns: "everything", view: "list" }),
  ])("falls back to defaults for a bad cookie: %s", async (raw) => {
    storeRaw(raw);
    const preferences = await mountPreferences();

    expect(sorted(preferences.visibleColumns.value)).toEqual(
      sorted(DEFAULT_VISIBLE_COLUMNS),
    );
    expect(preferences.view.value).toBe("table");
  });

  it("shows a newly added default-visible column under an old cookie", async () => {
    storeRaw(JSON.stringify({ columns: { sectors: true } }));
    const preferences = await mountPreferences();

    for (const id of DEFAULT_VISIBLE_COLUMNS) {
      expect(preferences.visibleColumns.value.has(id)).toBe(true);
    }
  });

  it("stores only overrides, and none once back at the default", async () => {
    const preferences = await mountPreferences();

    preferences.setColumnVisible("sectors", true);
    preferences.setColumnVisible("host", false);
    expect((await readCookie()).columns).toEqual({
      sectors: true,
      host: false,
    });

    preferences.setColumnVisible("host", true);
    expect((await readCookie()).columns).toEqual({ sectors: true });
    expect(preferences.visibleColumns.value.has("sectors")).toBe(true);
  });

  it("never hides the locked alias column", async () => {
    const preferences = await mountPreferences();

    preferences.setColumnVisible("alias", false);
    expect(preferences.visibleColumns.value.has("alias")).toBe(true);
  });

  it("resets columns but keeps the view", async () => {
    const preferences = await mountPreferences();
    preferences.setColumnVisible("sectors", true);
    preferences.view.value = "cards";

    preferences.resetColumns();
    expect(await readCookie()).toEqual({ columns: {}, view: "cards" });
    expect(preferences.isCustomised.value).toBe(false);
  });
});

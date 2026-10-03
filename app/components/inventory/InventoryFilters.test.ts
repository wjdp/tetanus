// @vitest-environment nuxt
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { flushPromises, type VueWrapper } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { CLEARED_FILTERS, type InventoryFilterState } from "./filterDisks";
import InventoryFilters from "./InventoryFilters.vue";
import { emptyInventoryDisk, mirrorMembership } from "./testFixtures";
import type { InventoryDisk } from "./types";

const disk = (overrides: Partial<InventoryDisk>): InventoryDisk =>
  emptyInventoryDisk(overrides);

const tank = mirrorMembership();

const DISKS = [
  disk({ id: 1, hostName: "mars", membership: tank }),
  disk({ id: 2, hostName: "mars" }),
  disk({ id: 3, hostName: "venus", membership: tank }),
  disk({ id: 4, hostName: "venus", membership: tank }),
  disk({
    id: 5,
    hostName: "venus",
    disposal: { kind: "rma", on: "2026-10-02" },
  }),
];

const mountFilters = async (filters: Partial<InventoryFilterState> = {}) => {
  const emitted: InventoryFilterState[] = [];
  const wrapper = await mountSuspended(InventoryFilters, {
    props: {
      disks: DISKS,
      modelValue: { ...CLEARED_FILTERS, ...filters },
      "onUpdate:modelValue": (value: InventoryFilterState) => {
        emitted.push(value);
      },
    },
    attachTo: document.body,
  });
  return { wrapper, emitted };
};

const select = (wrapper: VueWrapper, label: string) =>
  wrapper.get(`button[aria-label="Filter by ${label}"]`);

const openOptions = async (wrapper: VueWrapper, label: string) => {
  await select(wrapper, label).trigger("keydown", { key: "Enter" });
  await flushPromises();
  return [...document.body.querySelectorAll<HTMLElement>('[role="option"]')];
};

const optionCounts = (options: HTMLElement[]) =>
  Object.fromEntries(
    options.map((option) => [
      option.querySelector('[data-slot="itemLabel"]')?.textContent?.trim(),
      option.querySelector('[data-testid="filter-count"]')?.textContent?.trim(),
    ]),
  );

describe("InventoryFilters", () => {
  it("marks set filters primary and leaves idle ones neutral", async () => {
    const { wrapper } = await mountFilters({
      host: "mars",
      statuses: ["failed"],
    });

    expect(select(wrapper, "host").attributes("data-active")).toBeDefined();
    expect(select(wrapper, "status").attributes("data-active")).toBeDefined();
    expect(select(wrapper, "pool").attributes("data-active")).toBeUndefined();
    expect(select(wrapper, "host").classes()).toEqual(
      expect.arrayContaining(["bg-elevated/50", "ring-primary"]),
    );
    expect(select(wrapper, "pool").classes()).not.toContain("ring-primary");
  });

  it("shows the category icon when all, and the selected item's glyph when set", async () => {
    const { wrapper } = await mountFilters({
      states: ["spare"],
      statuses: ["warning"],
    });

    expect(
      select(wrapper, "host").get('[data-testid="filter-icon"]').classes(),
    ).toContain("i-lucide:server");
    expect(
      select(wrapper, "state").get('[data-testid="filter-icon"]').classes(),
    ).toContain("i-lucide:life-buoy");
    expect(
      select(wrapper, "status").get("[data-colour]").attributes("data-colour"),
    ).toBe("warning");
  });

  it("counts each option under the other filters", async () => {
    const { wrapper } = await mountFilters({ pool: "tank" });

    expect(optionCounts(await openOptions(wrapper, "host"))).toEqual({
      "All hosts": "3",
      mars: "1",
      venus: "2",
      "No host": "0",
    });
  });

  it("badges how many of the tucked-away filters are set", async () => {
    const idle = await mountFilters({ host: "mars" });
    expect(
      idle.wrapper.find('[data-testid="more-filters-count"]').exists(),
    ).toBe(false);

    const { wrapper } = await mountFilters({
      host: "mars",
      media: "ssd",
      vendor: "-",
    });
    expect(wrapper.get('[data-testid="more-filters-count"]').text()).toBe("2");
  });

  it("leaves disposed disks out of the counts until included", async () => {
    const hidden = await mountFilters();
    expect(optionCounts(await openOptions(hidden.wrapper, "host"))).toEqual({
      "All hosts": "4",
      mars: "2",
      venus: "2",
      "No host": "0",
    });
    hidden.wrapper.unmount();

    const shown = await mountFilters({ includeDisposed: true });
    expect(optionCounts(await openOptions(shown.wrapper, "host"))).toEqual({
      "All hosts": "5",
      mars: "2",
      venus: "3",
      "No host": "0",
    });
  });

  it("includes disposed disks from the Filters popover and badges it", async () => {
    const { wrapper, emitted } = await mountFilters();
    await wrapper.get('[data-testid="more-filters"]').trigger("click");
    await flushPromises();

    const toggle = document.body.querySelector<HTMLElement>(
      '[data-testid="include-disposed"]',
    );
    expect(toggle?.textContent).toContain("Include disposed");
    expect(toggle?.textContent).toContain("1");
    toggle?.querySelector<HTMLElement>('[role="switch"]')?.click();
    await flushPromises();

    expect(emitted.at(-1)).toEqual({
      ...CLEARED_FILTERS,
      includeDisposed: true,
    });

    const included = await mountFilters({ includeDisposed: true });
    expect(
      included.wrapper.get('[data-testid="more-filters-count"]').text(),
    ).toBe("1");
  });

  it("clears every filter", async () => {
    const { wrapper, emitted } = await mountFilters({ media: "ssd" });

    const clear = wrapper
      .findAll("button")
      .find((button) => button.text() === "Clear");
    await clear?.trigger("click");

    expect(emitted.at(-1)).toEqual(CLEARED_FILTERS);
  });
});

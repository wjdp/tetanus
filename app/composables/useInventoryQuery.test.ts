// @vitest-environment nuxt
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { flushPromises } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import {
  CLEARED_FILTERS,
  type InventoryFilterState,
  NONE,
} from "~/components/inventory/filterDisks";
import {
  DEFAULT_SORTING,
  inventoryQuery,
  parseInventoryQuery,
  SEARCH_DEBOUNCE_MS,
  useInventoryQuery,
} from "./useInventoryQuery";

const EVERY_FILTER: InventoryFilterState = {
  search: "wd red ",
  host: "mars",
  pool: "tank",
  usage: "zfs",
  purpose: "system",
  media: "hdd",
  interface: "sata",
  recording: "smr",
  vendor: "western-digital",
  tag: "spare",
  states: ["spare", "in-use"],
  statuses: ["failed", "warning"],
  includeDisposed: true,
};

const EVERY_NONE: InventoryFilterState = {
  ...CLEARED_FILTERS,
  host: NONE,
  pool: NONE,
  purpose: NONE,
  media: NONE,
  interface: NONE,
  recording: NONE,
  vendor: NONE,
  tag: NONE,
};

describe("inventory query string", () => {
  it.each([
    [
      "every filter, sorted descending",
      EVERY_FILTER,
      [{ id: "temp", desc: true }],
      "vendor",
    ],
    [
      "every none sentinel, sorted ascending",
      EVERY_NONE,
      [{ id: "vendor", desc: false }],
      null,
    ],
  ] as const)("round trips %s", (_name, filters, sorting, groupBy) => {
    const state = { filters, sorting: [...sorting], groupBy };
    const query = inventoryQuery(state);

    expect(parseInventoryQuery(query)).toEqual(state);
  });

  it("writes the documented keys", () => {
    expect(
      inventoryQuery({
        filters: EVERY_FILTER,
        sorting: [{ id: "temp", desc: true }],
        groupBy: "host",
      }),
    ).toEqual({
      q: "wd red ",
      host: "mars",
      pool: "tank",
      usage: "zfs",
      purpose: "system",
      media: "hdd",
      interface: "sata",
      recording: "smr",
      vendor: "western-digital",
      tag: "spare",
      state: "spare,in-use",
      status: "failed,warning",
      disposed: "1",
      sort: "-temp",
      group: "host",
    });
    expect(
      inventoryQuery({
        filters: EVERY_NONE,
        sorting: DEFAULT_SORTING,
        groupBy: null,
      }),
    ).toEqual({
      host: "none",
      pool: "none",
      purpose: "none",
      media: "none",
      interface: "none",
      recording: "none",
      vendor: "none",
      tag: "none",
    });
  });

  it("omits defaults, so the bare page is the cleared state", () => {
    expect(
      inventoryQuery({
        filters: CLEARED_FILTERS,
        sorting: DEFAULT_SORTING,
        groupBy: null,
      }),
    ).toEqual({});
    expect(parseInventoryQuery({})).toEqual({
      filters: CLEARED_FILTERS,
      sorting: DEFAULT_SORTING,
      groupBy: null,
    });
  });

  it("ignores unknown and invalid values", () => {
    expect(
      parseInventoryQuery({
        host: "",
        usage: "none",
        purpose: "gaming",
        media: "floppy",
        interface: "scsi",
        recording: "pmr",
        vendor: "acme",
        state: "spare,bogus,spare",
        status: "great",
        disposed: "yes",
        sort: "-nope",
        group: "colour",
      }),
    ).toEqual({
      filters: { ...CLEARED_FILTERS, states: ["spare"] },
      sorting: DEFAULT_SORTING,
      groupBy: null,
    });
  });

  it("takes the first of repeated keys", () => {
    expect(parseInventoryQuery({ media: ["ssd", "hdd"] }).filters.media).toBe(
      "ssd",
    );
  });
});

describe("useInventoryQuery", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const mountQuery = async (route: string) => {
    let state!: ReturnType<typeof useInventoryQuery>;
    await mountSuspended(
      defineComponent({
        setup() {
          state = useInventoryQuery();
          return () => h("div");
        },
      }),
      { route },
    );
    const router = useRouter();
    return {
      state,
      router,
      push: vi.spyOn(router, "push"),
      replace: vi.spyOn(router, "replace"),
    };
  };

  it("reads filters and sort from the route", async () => {
    const { state } = await mountQuery(
      "/disks?host=mars&status=failed&sort=-temp&q=K1",
    );

    expect(state.filters.value).toEqual({
      ...CLEARED_FILTERS,
      host: "mars",
      statuses: ["failed"],
      search: "K1",
    });
    expect(state.sorting.value).toEqual([{ id: "temp", desc: true }]);
  });

  it("pushes select changes and keeps unrelated keys", async () => {
    const { state, router, push, replace } = await mountQuery(
      "/disks?utm=x&media=ssd",
    );

    state.filters.value = { ...state.filters.value, host: NONE };

    await vi.waitFor(() =>
      expect(router.currentRoute.value.query).toEqual({
        utm: "x",
        media: "ssd",
        host: "none",
      }),
    );
    expect(push).toHaveBeenCalledOnce();
    expect(replace).not.toHaveBeenCalled();
    expect(state.filters.value.host).toBe(NONE);
  });

  it("pushes sort changes", async () => {
    const { state, router, push } = await mountQuery("/disks");

    state.sorting.value = [{ id: "capacity", desc: false }];

    await vi.waitFor(() =>
      expect(router.currentRoute.value.query).toEqual({ sort: "capacity" }),
    );
    expect(push).toHaveBeenCalledOnce();
  });

  it("replaces the search after a debounce", async () => {
    const { state, router, push, replace } =
      await mountQuery("/disks?pool=tank");

    state.filters.value = { ...state.filters.value, search: "a" };
    state.filters.value = { ...state.filters.value, search: "ab" };

    expect(state.filters.value.search).toBe("ab");
    expect(replace).not.toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(router.currentRoute.value.query).toEqual({
        pool: "tank",
        q: "ab",
      }),
    );
    expect(replace).toHaveBeenCalledOnce();
    expect(push).not.toHaveBeenCalled();
  });

  it("folds a pending search into a select push", async () => {
    const { state, router, push, replace } = await mountQuery("/disks");

    state.filters.value = { ...state.filters.value, search: "ab" };
    state.filters.value = { ...state.filters.value, media: "hdd" };
    await flushPromises();
    await new Promise((resolve) =>
      setTimeout(resolve, SEARCH_DEBOUNCE_MS + 50),
    );

    expect(push).toHaveBeenCalledOnce();
    expect(replace).not.toHaveBeenCalled();
    expect(router.currentRoute.value.query).toEqual({ q: "ab", media: "hdd" });
  });
});

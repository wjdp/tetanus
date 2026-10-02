// @vitest-environment nuxt
import { mountSuspended, registerEndpoint } from "@nuxt/test-utils/runtime";
import { flushPromises, type VueWrapper } from "@vue/test-utils";
import { getQuery } from "h3";
import { describe, expect, it, vi } from "vitest";
import ZfsPage from "./index.vue";

const pool = (id: number, name: string, archivedAt: string | null) => ({
  id,
  name,
  state: "ONLINE",
  sizeBytes: 1e12,
  allocBytes: 5e11,
  freeBytes: 5e11,
  cap: 50,
  frag: 1,
  dedup: 1,
  errors: 0,
  scan: null,
  archivedAt,
  archiveNote: "",
  host: { id: 1, name: "mars", displayName: null },
});

registerEndpoint("/api/pools", (event) => {
  const tank = pool(1, "tank", null);
  const tfault = pool(2, "tfault", "2026-10-02T09:00:00.000Z");
  return getQuery(event).archived === "include" ? [tank, tfault] : [tank];
});

const poolNames = (page: VueWrapper) =>
  page.findAll("tbody a").map((link) => link.text());

describe("ZFS page", () => {
  it("hides archived pools until asked, then badges them", async () => {
    const page = await mountSuspended(ZfsPage, { route: "/zfs" });
    expect(poolNames(page)).toEqual(["tank"]);
    expect(page.find('[data-testid="pool-archived-badge"]').exists()).toBe(
      false,
    );

    await page.get('button[data-testid="show-archived"]').trigger("click");
    await flushPromises();

    await vi.waitFor(() => expect(poolNames(page)).toEqual(["tank", "tfault"]));
    expect(page.findAll('[data-testid="pool-archived-badge"]')).toHaveLength(1);
  });

  it("reads the toggle from the query string", async () => {
    const page = await mountSuspended(ZfsPage, {
      route: "/zfs?archived=include",
    });
    expect(poolNames(page)).toEqual(["tank", "tfault"]);
  });
});

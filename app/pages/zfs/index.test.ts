// @vitest-environment nuxt
import { mountSuspended, registerEndpoint } from "@nuxt/test-utils/runtime";
import { flushPromises, type VueWrapper } from "@vue/test-utils";
import { getQuery } from "h3";
import { describe, expect, it, vi } from "vitest";
import ZfsPage from "./index.vue";

const pool = (
  id: number,
  name: string,
  archivedAt: string | null,
  displayState = "ONLINE",
) => ({
  id,
  name,
  state: "ONLINE",
  displayState,
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
  usable: null as { used: number; available: number } | null,
});

registerEndpoint("/api/pools", (event) => {
  const tank = {
    ...pool(1, "tank", null),
    usable: { used: 2 ** 40, available: 2 ** 39 },
  };
  const zeta = pool(3, "zeta", null, "MISSING");
  const tfault = pool(2, "tfault", "2026-10-02T09:00:00.000Z");
  return getQuery(event).archived === "include"
    ? [tank, tfault, zeta]
    : [tank, zeta];
});

const poolNames = (page: VueWrapper) =>
  page.findAll("tbody a").map((link) => link.text());

describe("ZFS page", () => {
  it("hides archived pools until asked, then badges them", async () => {
    const page = await mountSuspended(ZfsPage, { route: "/zfs" });
    expect(poolNames(page)).toEqual(["tank", "zeta"]);
    expect(page.find('[data-testid="pool-archived-badge"]').exists()).toBe(
      false,
    );

    await page.get('button[data-testid="show-archived"]').trigger("click");
    await flushPromises();

    await vi.waitFor(() =>
      expect(poolNames(page)).toEqual(["tank", "tfault", "zeta"]),
    );
    expect(page.findAll('[data-testid="pool-archived-badge"]')).toHaveLength(1);
  });

  it("shows usable used and available, marking raw figures when unknown", async () => {
    const page = await mountSuspended(ZfsPage, { route: "/zfs" });
    const cells = (name: string) =>
      page
        .findAll("tbody tr")
        .find((row) => row.text().includes(name))
        ?.findAll("td")
        .slice(3, 5)
        .map((cell) => cell.text().replace(/\s+/g, " "));

    expect(cells("tank")).toEqual(["1.00 TiB", "512 GiB"]);
    expect(cells("zeta")).toEqual(["466 GiB raw", "466 GiB raw"]);
  });

  it("reads the toggle from the query string", async () => {
    const page = await mountSuspended(ZfsPage, {
      route: "/zfs?archived=include",
    });
    expect(poolNames(page)).toEqual(["tank", "tfault", "zeta"]);
  });

  it("shows a missing pool as MISSING, keeping its last-seen state in the title", async () => {
    const page = await mountSuspended(ZfsPage, { route: "/zfs" });
    const [tankState, zetaState] = page.findAll('[data-testid="pool-state"]');

    expect(tankState?.text()).toBe("ONLINE");
    expect(zetaState?.text()).toBe("MISSING");
    expect(zetaState?.classes()).toContain("text-warning");
    expect(zetaState?.attributes("title")).toBe("Last seen ONLINE");
  });
});

// @vitest-environment nuxt
import { mountSuspended, registerEndpoint } from "@nuxt/test-utils/runtime";
import { describe, expect, it, vi } from "vitest";
import AppCommandPalette from "./AppCommandPalette.vue";

registerEndpoint("/api/disks", () => []);
registerEndpoint("/api/pools", () => []);
registerEndpoint("/api/datasets", () => ({
  datasets: [
    {
      id: 22,
      name: "tank/media/photos",
      pool: { id: 7, name: "tank" },
      host: { id: 1, name: "mars", displayName: null },
    },
  ],
}));

describe("AppCommandPalette", () => {
  it("lists datasets matching the search term", async () => {
    useCommandPalette().open();
    await mountSuspended(AppCommandPalette, { attachTo: document.body });

    const input = await vi.waitFor(() => {
      const found = document.body.querySelector<HTMLInputElement>(
        'input[placeholder="Search pages, disks, pools and datasets"]',
      );
      if (!found) throw new Error("palette input not rendered");
      return found;
    });
    input.value = "photos";
    input.dispatchEvent(new Event("input"));

    await vi.waitFor(() =>
      expect(document.body.textContent).toContain("mars · tank/media/photos"),
    );
    expect(document.body.textContent).toContain("Datasets");
  });
});

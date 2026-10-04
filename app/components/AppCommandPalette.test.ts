// @vitest-environment nuxt
import { mountSuspended, registerEndpoint } from "@nuxt/test-utils/runtime";
import { describe, expect, it, vi } from "vitest";
import AppCommandPalette from "./AppCommandPalette.vue";

registerEndpoint("/api/hosts", () => [
  { id: 1, name: "mars", displayName: null },
]);
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
  it("offers the faults page with the siren icon", async () => {
    useCommandPalette().open();
    await mountSuspended(AppCommandPalette, { attachTo: document.body });

    const option = await vi.waitFor(() => {
      const found = [...document.body.querySelectorAll('[role="option"]')].find(
        (item) => item.textContent?.trim() === "Faults",
      );
      if (!found) throw new Error("Faults option not rendered");
      return found;
    });
    expect(option.innerHTML).toContain("siren");
  });

  it("offers each host and the add host action", async () => {
    const palette = useCommandPalette();
    palette.close();
    await mountSuspended(AppCommandPalette, { attachTo: document.body });
    palette.open();

    await vi.waitFor(() => {
      const labels = [...document.body.querySelectorAll('[role="option"]')].map(
        (item) => item.textContent?.trim(),
      );
      expect(labels).toContain("mars");
      expect(labels).toContain("Add host");
    });
  });

  it("lists datasets matching the search term", async () => {
    useCommandPalette().open();
    await mountSuspended(AppCommandPalette, { attachTo: document.body });

    const input = await vi.waitFor(() => {
      const found = document.body.querySelector<HTMLInputElement>(
        'input[placeholder="Search pages, hosts, disks, pools and datasets"]',
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
    const option = [...document.body.querySelectorAll('[role="option"]')].find(
      (item) => item.textContent?.includes("tank/media/photos"),
    );
    expect(option?.innerHTML).toContain("folder-tree");
  });
});

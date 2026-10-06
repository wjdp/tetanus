// @vitest-environment nuxt
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { describe, expect, it } from "vitest";
import DatasetPage from "./Page.vue";
import { photos } from "./testFixtures";

describe("dataset page", () => {
  it("shows the header, properties, snapshots and diary", async () => {
    const page = await mountSuspended(DatasetPage, {
      props: { dataset: photos() },
    });

    expect(page.get("h1").text()).toBe("photos");
    expect(page.text()).toContain("tank/media/photos");
    expect(page.text()).toContain("destroyed");
    expect(page.get('a[href="/zfs/nas1/tank"]').text()).toBe("nas1 · tank");

    const properties = page.get('[data-testid="properties-panel"]').text();
    expect(properties).toContain("1.07×");
    expect(properties).toContain("zstd");
    expect(properties).toContain("aes-256-gcm");
    expect(properties).toContain("1.82 TiB");
    expect(properties).toContain("2024-03-01 12:00 UTC");

    expect(page.get('[data-testid="used-panel"]').text()).toContain(
      "Not enough readings",
    );
    expect(page.text()).toContain("Moved photos off the old array");

    const replications = page.get('[data-testid="dataset-replications"]');
    expect(replications.get("tbody th").text()).toMatch(/atlas\s*styx\s*1/);
    expect(replications.get('table a[href="/replications/8"]').text()).toBe(
      "vault/replica/tank/media/photos",
    );
    expect(replications.text()).toContain("Late");
  });

  it("shows snapshots newest first, a hundred at a time", async () => {
    const page = await mountSuspended(DatasetPage, {
      props: { dataset: photos() },
    });
    const rows = () => page.findAll('[data-testid="snapshot-table"] tbody tr');

    expect(rows()).toHaveLength(100);
    expect(rows()[0].text()).toContain("auto-150");
    expect(rows()[0].text()).toContain("6 h");

    const more = page
      .findAll("button")
      .find((button) => button.text().startsWith("Show 50 more"));
    await more?.trigger("click");
    expect(rows()).toHaveLength(150);
  });

  it("links children by name under the pool's path", async () => {
    const page = await mountSuspended(DatasetPage, {
      props: {
        dataset: {
          ...photos(),
          children: [
            {
              id: 23,
              name: "tank/media/photos/raw",
              present: true,
              used: 1e9,
            },
          ],
        },
      },
    });

    expect(page.get('a[href="/zfs/nas1/tank/media/photos/raw"]').text()).toBe(
      "raw",
    );
  });
});

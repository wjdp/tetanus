// @vitest-environment nuxt
import { mountSuspended, registerEndpoint } from "@nuxt/test-utils/runtime";
import { describe, expect, it } from "vitest";
import { COLLECTOR_VERSION } from "#shared/collector";
import HostsPage from "./index.vue";

const HOUR_MS = 60 * 60 * 1000;
const hoursAgo = (hours: number) =>
  new Date(Date.now() - hours * HOUR_MS).toISOString();

const host = (
  id: number,
  name: string,
  collectorVersion: string | null,
  lastRuns: Record<string, { receivedAt: string; ok: boolean }> = {},
  intermittent = false,
) => ({
  id,
  name,
  displayName: null,
  toolVersions: {
    zfs: "zfs-2.4.1-1ubuntu5.1",
    smartctl:
      "smartctl 7.5 2025-04-30 r5714 [x86_64-linux-7.0.0-34-generic] (local build)",
  },
  collectorVersion,
  collectorStatus: "current",
  healthchecksUrl: null,
  intermittent,
  position: id,
  notes: "",
  temperatureThresholds: null,
  firstSeenAt: new Date().toISOString(),
  lastSeenAt: new Date().toISOString(),
  lastRuns,
});

registerEndpoint("/api/hosts", () => [
  host(1, "mars", COLLECTOR_VERSION, {
    "zpool-status": { receivedAt: hoursAgo(0), ok: true },
    "smartctl-xall": { receivedAt: hoursAgo(3), ok: true },
  }),
  host(2, "pihost", "0.3.0"),
  host(3, "venus", "0.2.0"),
  host(4, "ceres", null),
  host(
    5,
    "bench",
    COLLECTOR_VERSION,
    { "zpool-status": { receivedAt: hoursAgo(24 * 9), ok: true } },
    true,
  ),
]);

const rowText = (
  page: { findAll(selector: string): { text(): string }[] },
  name: string,
) =>
  page
    .findAll("tbody tr")
    .map((row) => row.text())
    .find((text) => text.startsWith(name)) ?? "";

describe("hosts page", () => {
  it("badges each collector that is not current", async () => {
    const page = await mountSuspended(HostsPage);

    expect(rowText(page, "mars")).not.toContain("available");
    expect(rowText(page, "pihost")).toContain(`${COLLECTOR_VERSION} available`);
    expect(rowText(page, "venus")).toContain("needs 0.3.0+");
    expect(rowText(page, "ceres")).toContain("unknown");
  });

  it("colours freshness chips neutral, warning and error", async () => {
    const page = await mountSuspended(HostsPage);

    const mars = page
      .findAll("tbody tr")
      .find((row) => row.text().startsWith("mars"));
    const chipClasses = (group: string) =>
      mars
        ?.findAll("span")
        .find((chip) => chip.text().startsWith(`${group}:`))
        ?.classes() ?? [];
    expect(chipClasses("zfs")).toContain("text-default");
    expect(chipClasses("smart")).toContain("text-warning");
    expect(chipClasses("snapshots")).toContain("text-error");
  });

  it("badges an intermittent host and shows it offline", async () => {
    const page = await mountSuspended(HostsPage);

    expect(rowText(page, "bench")).toContain("intermittent");
    expect(rowText(page, "bench")).toContain("offline · last seen");
    expect(rowText(page, "bench")).not.toContain("zfs:");
    expect(rowText(page, "mars")).not.toContain("intermittent");
  });

  it("gives each row a drag handle", async () => {
    const page = await mountSuspended(HostsPage);

    expect(page.findAll("tbody tr [data-drag-handle]")).toHaveLength(5);
  });

  it("shortens tool versions", async () => {
    const page = await mountSuspended(HostsPage);

    expect(rowText(page, "mars")).toContain("zfs 2.4.1-1ubuntu5.1");
    expect(rowText(page, "mars")).toContain("smartctl 7.5");
    expect(rowText(page, "mars")).not.toContain("local build");
  });

  it("offers the upgrade command to outdated and incompatible hosts", async () => {
    const page = await mountSuspended(HostsPage);

    expect(page.text()).toContain("Run this on pihost, venus.");
    const commands = page
      .findAll('[data-testid="command"]')
      .map((c) => c.text());
    expect(commands).toContainEqual(
      expect.stringMatching(/\/host\/install\.sh \| sudo bash$/),
    );
  });

  it("links each host to its page and offers to add one", async () => {
    const page = await mountSuspended(HostsPage);

    expect(page.find('tbody a[href="/hosts/pihost"]').text()).toBe("pihost");
    expect(page.find('[data-testid="add-host"]').attributes("href")).toBe(
      "/hosts/add",
    );
  });

  it("lists each host as a stacked item for phones", async () => {
    const page = await mountSuspended(HostsPage);
    const list = page.get('[data-testid="host-list"]');
    expect(list.classes()).toContain("md:hidden");

    const items = list.findAll('[data-testid="host-list-item"]');
    expect(items).toHaveLength(5);
    expect(items[1].attributes("href")).toBe("/hosts/pihost");
    expect(items[1].text()).toContain("pihost");
    expect(items[1].get('[data-testid="host-list-meta"]').text()).toMatch(
      new RegExp(
        `collector 0\\.3\\.0\\s*${COLLECTOR_VERSION.replaceAll(".", "\\.")} available`,
      ),
    );
    expect(items[4].text()).toContain("intermittent");
  });
});

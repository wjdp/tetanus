// @vitest-environment nuxt
import { mountSuspended, registerEndpoint } from "@nuxt/test-utils/runtime";
import { describe, expect, it } from "vitest";
import { nextTick } from "vue";
import HostsPage from "./hosts.vue";

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
  host(1, "mars", "0.3.1", {
    "zpool-status": { receivedAt: hoursAgo(0), ok: true },
    "smartctl-xall": { receivedAt: hoursAgo(3), ok: true },
  }),
  host(2, "pihost", "0.3.0"),
  host(3, "venus", "0.2.0"),
  host(4, "ceres", null),
  host(
    5,
    "bench",
    "0.3.1",
    { "zpool-status": { receivedAt: hoursAgo(24 * 9), ok: true } },
    true,
  ),
]);
registerEndpoint("/api/settings", () => ({ enrolToken: "ab".repeat(32) }));

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
    expect(rowText(page, "pihost")).toContain("0.3.1 available");
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

  it("shows the default temperature thresholds as placeholders", async () => {
    const page = await mountSuspended(HostsPage, { attachTo: document.body });

    await page.find("tbody tr").trigger("click");
    await nextTick();
    await nextTick();

    const placeholders = [
      ...document.body.querySelectorAll<HTMLInputElement>(
        'input[type="number"]',
      ),
    ].map((input) => input.placeholder);
    expect(placeholders).toEqual(["45", "55", "60", "70"]);
    expect(document.body.textContent).toContain("Temperature thresholds (°C)");
    page.unmount();
  });
});

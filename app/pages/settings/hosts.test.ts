// @vitest-environment nuxt
import { mountSuspended, registerEndpoint } from "@nuxt/test-utils/runtime";
import { describe, expect, it } from "vitest";
import HostsPage from "./hosts.vue";

const host = (id: number, name: string, collectorVersion: string | null) => ({
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
  notes: "",
  firstSeenAt: new Date().toISOString(),
  lastSeenAt: new Date().toISOString(),
  lastRuns: {},
});

registerEndpoint("/api/hosts", () => [
  host(1, "mars", "0.3.1"),
  host(2, "pihost", "0.3.0"),
  host(3, "venus", "0.2.0"),
  host(4, "ceres", null),
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
});

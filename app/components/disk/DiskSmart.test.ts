// @vitest-environment nuxt
import { mountSuspended, registerEndpoint } from "@nuxt/test-utils/runtime";
import { describe, expect, it } from "vitest";
import DiskSmart from "./DiskSmart.vue";

const at = "2026-09-20T12:00:00.000Z";

function smartOverview(importedUntil: string | null, deviceStatus = "passed") {
  return {
    reading: {
      id: 1,
      takenAt: at,
      devicePath: "/dev/sdb",
      deviceStatus,
      source: "collector",
    },
    attributes: [],
    history: { temperature: [], attributes: {}, importedUntil },
    selfTests: [],
    acceptances: [],
  };
}

registerEndpoint("/api/disks/21/smart", () =>
  smartOverview("2026-09-09T00:00:00.000Z"),
);
registerEndpoint("/api/disks/22/smart", () => smartOverview(null));
registerEndpoint("/api/disks/23/smart", () => smartOverview(null, "unknown"));
registerEndpoint("/api/disks/24/smart", () => smartOverview(null, "failed"));
registerEndpoint("/api/disks/25/smart", () => ({
  ...smartOverview(null),
  reading: null,
}));

const note = '[data-testid="imported-note"]';

describe("DiskSmart", () => {
  it("notes when readings in range were imported from scrutiny", async () => {
    const component = await mountSuspended(DiskSmart, {
      props: { diskId: 21, protocol: "ata" },
    });

    expect(component.get(note).text()).toBe(
      "Readings before 2026-09-09 were imported from scrutiny at daily resolution",
    );
  });

  it("shows no note for collector-only history", async () => {
    const component = await mountSuspended(DiskSmart, {
      props: { diskId: 22, protocol: "ata" },
    });

    expect(component.text()).toContain("read 2026-09-20");
    expect(component.find(note).exists()).toBe(false);
  });

  it.each([
    [22, "passed", "text-default"],
    [23, "unknown", "text-default"],
    [24, "failed", "text-error"],
  ])(
    "badges disk %i as %s in %s, leaving green to the nameplate",
    async (diskId, status, textClass) => {
      const component = await mountSuspended(DiskSmart, {
        props: { diskId, protocol: "ata" },
      });

      const badge = component.get('[data-testid="smart-status"]');
      expect(badge.text()).toBe(status);
      expect(badge.classes()).toContain(textClass);
      expect(badge.classes()).not.toContain("text-success");
    },
  );

  it("shows the range tabs without a heading, even with no readings", async () => {
    const component = await mountSuspended(DiskSmart, {
      props: { diskId: 25, protocol: "ata" },
    });

    expect(component.text()).toContain("No SMART readings yet.");
    expect(component.find("h2").exists()).toBe(false);
    expect(
      component.findAll('[role="tab"]').map((tab) => tab.text()),
    ).toContain("30d");
  });
});

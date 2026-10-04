// @vitest-environment nuxt
import { mountSuspended, registerEndpoint } from "@nuxt/test-utils/runtime";
import { flushPromises, type VueWrapper } from "@vue/test-utils";
import { getQuery, readBody } from "h3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, nextTick } from "vue";
import { clearNuxtData } from "#app";
import type { FaultView } from "#shared/faults";
import { diskFixture } from "~/components/topology/testFixtures";
import { FakeEventSource } from "~~/test/fakeEventSource";
import HostPage from "./[id].vue";

const now = new Date().toISOString();

const HOST = {
  id: 2,
  name: "mars",
  displayName: "Mars NAS",
  toolVersions: {
    zfs: "zfs-2.4.1-1ubuntu5.1",
    kernel: "7.0.0-34-generic",
  },
  collectorVersion: "0.3.0",
  collectorStatus: "outdated",
  healthchecksUrl: null,
  intermittent: false,
  position: 1,
  notes: "Under the **stairs**",
  temperatureThresholds: { hdd: { warning: 40, error: 50 } },
  firstSeenAt: now,
  lastSeenAt: now,
  lastRuns: {},
};

const fault = (
  id: number,
  overrides: Partial<FaultView> & Pick<FaultView, "kind" | "subject">,
): FaultView => ({
  category: "disk",
  severity: "error",
  state: "open",
  key: String(id),
  note: "",
  openedAt: now,
  lastSeenAt: now,
  resolvedAt: null,
  stateChangedAt: now,
  data: {},
  id,
  ...overrides,
});

const FAULTS: FaultView[] = [
  fault(1, {
    kind: "collector-outdated",
    category: "host",
    severity: "warning",
    data: { version: "0.3.0", currentVersion: "0.6.0" },
    subject: { type: "host", id: 2, label: "mars", hostName: "mars" },
  }),
  fault(2, {
    kind: "smart-attribute",
    data: { attrId: "5", name: "Reallocated Sectors Count", value: 8 },
    subject: { type: "disk", id: 12, label: "A7", hostName: "mars" },
  }),
];

const patches: unknown[] = [];
const faultQueries: unknown[] = [];

registerEndpoint("/api/hosts/2", {
  method: "GET",
  handler: () => HOST,
});
registerEndpoint("/api/hosts/2", {
  method: "PATCH",
  handler: async (event) => {
    patches.push(await readBody(event));
    return HOST;
  },
});
registerEndpoint("/api/pools", () => []);
registerEndpoint("/api/disks", () => [
  diskFixture(12, {
    lastSeenHostId: 2,
    present: true,
    media: "hdd",
    capacityBytes: 4e12,
  }),
  diskFixture(13, { lastSeenHostId: 3 }),
]);
registerEndpoint("/api/diary", (event) => {
  const query = getQuery(event);
  return query.subjectType === "host" && query.subjectId === "2"
    ? [
        {
          id: 9,
          subjectType: "host",
          subjectId: 2,
          at: now,
          kind: "manual",
          eventType: null,
          title: "Moved to the loft",
          body: "",
          data: null,
        },
      ]
    : [];
});
registerEndpoint("/api/faults", (event) => {
  faultQueries.push(getQuery(event));
  return {
    faults: FAULTS,
    counts: { open: 2, acknowledged: 0, accepted: 0, resolved: 0 },
  };
});

beforeEach(() => {
  FakeEventSource.install();
  clearNuxtData();
  patches.length = 0;
  faultQueries.length = 0;
});

// UTooltip needs the provider UApp installs in app.vue; the page is mounted alone.
const TooltipPassthrough = defineComponent({
  setup:
    (_, { slots }) =>
    () =>
      slots.default?.(),
});
const mountPage = () =>
  mountSuspended(HostPage, {
    route: "/hosts/2",
    global: { stubs: { UTooltip: TooltipPassthrough } },
  });

const openTab = async (page: VueWrapper, label: string) => {
  await page
    .findAll('[role="tab"]')
    .find((tab) => tab.text().startsWith(label))
    ?.trigger("mousedown");
  await nextTick();
};

describe("host page", () => {
  it("shows the header with the host's own disks", async () => {
    const page = await mountPage();

    expect(page.get("h1").text()).toBe("Mars NAS");
    expect(page.text()).toContain("mars");
    const summary = page.get('[data-testid="host-summary"]').text();
    expect(summary).toContain("0 pools · 1 disk · 1 HDD");
    expect(page.findAll('[data-testid="host-disk-group"]')).toHaveLength(1);
  });

  it("lists host faults in full and summarises the rest", async () => {
    const page = await mountPage();

    await vi.waitFor(() =>
      expect(page.find('[data-testid="host-faults"]').exists()).toBe(true),
    );
    expect(faultQueries[0]).toMatchObject({ host: "mars" });
    const summary = page.get('[data-testid="subject-fault-summary"]');
    expect(summary.find('a[href="/disks/12"]').text()).toBe("A7");
    expect(summary.text()).toContain("1 error");
    expect(summary.find('a[href="/faults?host=mars"]').exists()).toBe(true);
  });

  it("shows every tool version and the upgrade command", async () => {
    const page = await mountPage();

    const collector = page.get('[data-testid="collector-panel"]').text();
    expect(collector).toContain("0.6.0 available");
    expect(collector).toContain("7.0.0-34-generic");
    expect(collector).toContain("install.sh | sudo bash");
  });

  it("renders the notes and the host diary", async () => {
    const page = await mountPage();

    expect(page.get('[data-testid="host-notes"]').html()).toContain(
      "<strong>stairs</strong>",
    );
    await openTab(page, "Diary");
    expect(page.text()).toContain("Moved to the loft");
  });

  it("saves the settings", async () => {
    const page = await mountPage();

    await openTab(page, "Settings");
    const form = page.get('[data-testid="host-settings"]');
    const placeholders = form
      .findAll('input[type="number"]')
      .map((input) => input.attributes("placeholder"));
    expect(placeholders).toEqual(["45", "55", "60", "70"]);

    await form.trigger("submit");
    await flushPromises();
    expect(patches).toEqual([
      {
        displayName: "Mars NAS",
        intermittent: false,
        healthchecksUrl: "",
        notes: "Under the **stairs**",
        temperatureThresholds: { hdd: { warning: 40, error: 50 } },
      },
    ]);
  });
});

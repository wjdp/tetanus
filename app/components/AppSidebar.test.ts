// @vitest-environment nuxt
import {
  mockNuxtImport,
  mountSuspended,
  registerEndpoint,
} from "@nuxt/test-utils/runtime";
import UApp from "@nuxt/ui/components/App.vue";
import UDashboardGroup from "@nuxt/ui/components/DashboardGroup.vue";
import { beforeEach, describe, expect, it } from "vitest";
import { defineComponent, h } from "vue";
import type { NavigationCounts } from "#shared/navigation";
import { FakeEventSource } from "~~/test/fakeEventSource";
import AppSidebar from "./AppSidebar.vue";

registerEndpoint("/api/tasks", () => []);

const zero = () => ({ error: 0, warning: 0, neutral: 0 });
const counts = ref<NavigationCounts>({
  faults: zero(),
  disks: zero(),
  pools: zero(),
});
mockNuxtImport("useNavigationCounts", () => () => counts);

const mountSidebar = async (collapsed = false) => {
  const component = await mountSuspended(
    defineComponent({
      setup: () => () =>
        h(UApp, null, () => h(UDashboardGroup, null, () => h(AppSidebar))),
    }),
  );
  if (collapsed) {
    await component
      .get('button[aria-label="Collapse sidebar"]')
      .trigger("click");
  }
  return component;
};

type Mounted = Awaited<ReturnType<typeof mountSidebar>>;

const link = (component: Mounted, href: string) =>
  component.get(`nav a[href="${href}"]`);

const badgesOf = (component: Mounted, href: string) =>
  link(component, href)
    .findAll("[data-bucket]")
    .map((badge) => [badge.attributes("data-bucket"), badge.text()]);

const chipOf = (component: Mounted, href: string) =>
  link(component, href).find(
    '[data-slot="linkLeadingChip"] [data-slot="base"]',
  );

beforeEach(() => {
  FakeEventSource.install();
  counts.value = { faults: zero(), disks: zero(), pools: zero() };
});

describe("AppSidebar", () => {
  it("links to Faults after Topology", async () => {
    const component = await mountSidebar();

    const hrefs = component
      .findAll("nav a")
      .map((anchor) => anchor.attributes("href"));
    expect(hrefs.indexOf("/faults")).toBe(hrefs.indexOf("/") + 1);
  });

  it("hides every count at zero", async () => {
    const component = await mountSidebar();

    expect(link(component, "/faults").text()).toBe("Faults");
    expect(link(component, "/disks").text()).toBe("Disks");
    expect(link(component, "/zfs").text()).toBe("ZFS");
  });

  it("shows non-zero counts red, amber, then neutral", async () => {
    counts.value = {
      faults: { error: 2, warning: 5, neutral: 0 },
      disks: { error: 0, warning: 1, neutral: 9 },
      pools: { error: 0, warning: 0, neutral: 3 },
    };
    const component = await mountSidebar();

    expect(badgesOf(component, "/faults")).toEqual([
      ["error", "2"],
      ["warning", "5"],
    ]);
    expect(badgesOf(component, "/disks")).toEqual([
      ["warning", "1"],
      ["neutral", "9"],
    ]);
    expect(badgesOf(component, "/zfs")).toEqual([["neutral", "3"]]);
    expect(badgesOf(component, "/diary")).toEqual([]);
  });

  it("puts a chip of the worst colour on the icon only when collapsed", async () => {
    counts.value = {
      faults: { error: 2, warning: 5, neutral: 0 },
      disks: { error: 0, warning: 1, neutral: 9 },
      pools: { error: 0, warning: 0, neutral: 3 },
    };

    const expanded = await mountSidebar();
    expect(chipOf(expanded, "/faults").exists()).toBe(false);

    const collapsed = await mountSidebar(true);
    expect(chipOf(collapsed, "/faults").classes()).toContain("bg-error");
    expect(chipOf(collapsed, "/disks").classes()).toContain("bg-warning");
    expect(chipOf(collapsed, "/zfs").exists()).toBe(false);
    expect(badgesOf(collapsed, "/faults")).toEqual([]);
  });
});

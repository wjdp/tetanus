// @vitest-environment nuxt
import {
  mockNuxtImport,
  mountSuspended,
  registerEndpoint,
} from "@nuxt/test-utils/runtime";
import UDashboardGroup from "@nuxt/ui/components/DashboardGroup.vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { FakeEventSource } from "~~/test/fakeEventSource";
import AppSidebar from "./AppSidebar.vue";

registerEndpoint("/api/tasks", () => []);

const badge = ref(0);
const useFaultsMock = vi.fn((_query: unknown) => ({ badge }));
mockNuxtImport("useFaults", () => (query: unknown) => useFaultsMock(query));

const InDashboard = defineComponent({
  setup: () => () => h(UDashboardGroup, null, () => h(AppSidebar)),
});

const faultsLink = (component: Awaited<ReturnType<typeof mountSuspended>>) =>
  component.get('a[href="/faults"]');

beforeEach(() => {
  FakeEventSource.install();
  badge.value = 0;
});

describe("AppSidebar", () => {
  it("links to Faults after Topology", async () => {
    const component = await mountSuspended(InDashboard);

    const hrefs = component
      .findAll("nav a")
      .map((link) => link.attributes("href"));
    expect(hrefs.indexOf("/faults")).toBe(hrefs.indexOf("/") + 1);
  });

  it("hides the faults badge at zero", async () => {
    const component = await mountSuspended(InDashboard);

    expect(faultsLink(component).text()).toBe("Faults");
  });

  it("shows the open error count as the faults badge", async () => {
    badge.value = 3;
    const component = await mountSuspended(InDashboard);

    expect(faultsLink(component).text()).toContain("3");
    expect(useFaultsMock).toHaveBeenCalledWith({
      state: "open",
      severity: "error",
    });
  });
});

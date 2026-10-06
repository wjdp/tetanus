// @vitest-environment nuxt
import {
  mockNuxtImport,
  mountSuspended,
  registerEndpoint,
} from "@nuxt/test-utils/runtime";
import UApp from "@nuxt/ui/components/App.vue";
import UDashboardGroup from "@nuxt/ui/components/DashboardGroup.vue";
import { flushPromises } from "@vue/test-utils";
import { beforeEach, describe, expect, it } from "vitest";
import { defineComponent, h } from "vue";
import type { NavigationCounts } from "#shared/navigation";
import { FakeEventSource } from "~~/test/fakeEventSource";
import AppBottomNav from "./AppBottomNav.vue";
import AppSidebar from "./AppSidebar.vue";

registerEndpoint("/api/tasks", () => []);

const zero = () => ({ error: 0, warning: 0, neutral: 0 });
const counts = ref<NavigationCounts>({
  faults: zero(),
  hosts: zero(),
  disks: zero(),
  pools: zero(),
  replications: zero(),
});
mockNuxtImport("useNavigationCounts", () => () => counts);

const mountBottomNav = async (route = "/") =>
  mountSuspended(
    defineComponent({
      setup: () => () =>
        h(UApp, null, () =>
          h(UDashboardGroup, null, () => [h(AppSidebar), h(AppBottomNav)]),
        ),
    }),
    { route, attachTo: document.body },
  );

type Mounted = Awaited<ReturnType<typeof mountBottomNav>>;

const bar = (component: Mounted) => component.get('nav[aria-label="Sections"]');

const chipOf = (component: Mounted, href: string) =>
  bar(component).get(`a[href="${href}"]`).find('[data-slot="base"]');

beforeEach(() => {
  FakeEventSource.install();
  counts.value = {
    faults: zero(),
    hosts: zero(),
    disks: zero(),
    pools: zero(),
    replications: zero(),
  };
});

describe("AppBottomNav", () => {
  it("links the primary sections in navigation order, then More", async () => {
    const component = await mountBottomNav();

    expect(
      bar(component)
        .findAll("a")
        .map((a) => a.text()),
    ).toEqual(["Topology", "Faults", "Disks", "ZFS"]);
    expect(bar(component).get("button").text()).toBe("More");
  });

  it.each([
    ["/", "/"],
    ["/disks", "/disks"],
    ["/disks/12", "/disks"],
    ["/zfs/nas1/tank/media", "/zfs"],
  ])("on %s marks only %s active", async (route, href) => {
    const component = await mountBottomNav(route);

    const current = bar(component)
      .findAll("a")
      .filter((a) => a.attributes("aria-current") === "page")
      .map((a) => a.attributes("href"));
    expect(current).toEqual([href]);
  });

  it("puts a chip of the worst colour on the icon, matching the collapsed sidebar", async () => {
    counts.value = {
      faults: { error: 2, warning: 5, neutral: 0 },
      hosts: zero(),
      disks: { error: 0, warning: 1, neutral: 9 },
      pools: { error: 0, warning: 0, neutral: 3 },
      replications: zero(),
    };
    const component = await mountBottomNav();

    expect(chipOf(component, "/faults").classes()).toContain("bg-error");
    expect(chipOf(component, "/disks").classes()).toContain("bg-warning");
    expect(chipOf(component, "/zfs").exists()).toBe(false);
  });

  it("opens the sidebar drawer from More", async () => {
    const component = await mountBottomNav();
    expect(document.querySelector('[role="dialog"]')).toBeNull();

    await bar(component).get("button").trigger("click");
    await flushPromises();

    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    component.unmount();
  });
});

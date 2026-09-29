// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Fault } from "#shared/faults";
import AppFaultBanners from "./AppFaultBanners.vue";

const faults = ref<Fault[]>([]);
const dismiss = vi.fn();
mockNuxtImport("useFaults", () => () => ({ faults, dismiss }));

beforeEach(() => {
  faults.value = [];
});

describe("AppFaultBanners", () => {
  it("renders nothing without faults", async () => {
    const component = await mountSuspended(AppFaultBanners);
    expect(component.html()).not.toContain("<section");
  });

  it("renders one alert per fault", async () => {
    faults.value = [
      { id: "zfs-silent", host: "mars", title: "No data for 3 h" },
      {
        id: "old",
        host: "pihost",
        title: "Collector 0.2.0 is too old",
        command: "curl -fsSL http://x/host/install.sh | sudo bash",
      },
    ];
    const component = await mountSuspended(AppFaultBanners);
    expect(component.text()).toContain("mars");
    expect(component.text()).toContain("No data for 3 h");
    expect(component.text()).toContain("pihost");
    expect(component.text()).toContain("Collector 0.2.0 is too old");
    expect(component.get("code").text()).toBe(
      "curl -fsSL http://x/host/install.sh | sudo bash",
    );
  });

  it("marks each fault with a 3 px error gutter", async () => {
    faults.value = [
      { id: "zfs-silent", host: "mars", title: "No data for 3 h" },
    ];
    const component = await mountSuspended(AppFaultBanners);
    const row = component.get("section > div");
    expect(row.classes()).toEqual(
      expect.arrayContaining(["border-s-[3px]", "border-s-error"]),
    );
  });

  it("dismisses a fault via its close button", async () => {
    faults.value = [
      { id: "zfs-silent", host: "mars", title: "No data for 3 h" },
    ];
    const component = await mountSuspended(AppFaultBanners);

    await component.get('button[aria-label="Close"]').trigger("click");

    expect(dismiss).toHaveBeenCalledWith("zfs-silent");
  });
});

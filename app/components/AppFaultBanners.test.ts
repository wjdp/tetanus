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
    expect(component.html()).not.toContain("<div");
  });

  it("renders one alert per fault", async () => {
    faults.value = [
      { id: "zfs-silent", title: "No ZFS data for 3 h" },
      { id: "drift", title: "vdev_id.conf drift", description: "K3" },
    ];
    const component = await mountSuspended(AppFaultBanners);
    expect(component.text()).toContain("No ZFS data for 3 h");
    expect(component.text()).toContain("vdev_id.conf drift");
  });

  it("dismisses a fault via its close button", async () => {
    faults.value = [{ id: "zfs-silent", title: "No ZFS data for 3 h" }];
    const component = await mountSuspended(AppFaultBanners);

    await component.get('button[aria-label="Close"]').trigger("click");

    expect(dismiss).toHaveBeenCalledWith("zfs-silent");
  });
});

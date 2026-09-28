// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime";
import { beforeEach, describe, expect, it } from "vitest";
import type { Fault } from "#shared/faults";
import AppFaultBanners from "./AppFaultBanners.vue";

const faults = ref<Fault[]>([]);
mockNuxtImport("useFaults", () => () => faults);

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
});

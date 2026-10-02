// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime";
import { flushPromises } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SimulationView } from "#shared/simulator";
import { FakeEventSource } from "~~/test/fakeEventSource";
import AppSimulationBanner from "./AppSimulationBanner.vue";

FakeEventSource.install();

const simulations = ref<SimulationView[]>([]);
const restore = vi.fn();
mockNuxtImport("useSimulator", () => () => ({
  enabled: true,
  simulations,
  restore,
  simulate: vi.fn(),
  refresh: vi.fn().mockResolvedValue(undefined),
}));

const simulation = (id: number): SimulationView => ({
  id,
  scenario: "smart-health-failed",
  label: "SMART health failed",
  subjectType: "disk",
  subjectId: 7,
  createdAt: "2026-10-02T12:00:00.000Z",
});

beforeEach(() => {
  simulations.value = [];
  restore.mockReset();
});

describe("AppSimulationBanner", () => {
  it("renders nothing without simulations", async () => {
    const component = await mountSuspended(AppSimulationBanner);
    expect(component.find('[data-testid="simulation-banner"]').exists()).toBe(
      false,
    );
  });

  it("counts active simulations and restores on click", async () => {
    simulations.value = [simulation(1), simulation(2)];
    const component = await mountSuspended(AppSimulationBanner);
    const banner = component.get('[data-testid="simulation-banner"]');
    expect(banner.text()).toContain("2 simulated faults active");

    await banner.get("button").trigger("click");
    await flushPromises();
    expect(restore).toHaveBeenCalled();
  });
});

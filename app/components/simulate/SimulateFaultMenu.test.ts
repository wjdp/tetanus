// @vitest-environment nuxt
import {
  mockNuxtImport,
  mountSuspended,
  registerEndpoint,
} from "@nuxt/test-utils/runtime";
import { flushPromises } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SimulationView, SubjectScenarios } from "#shared/simulator";
import SimulateFaultMenu from "./SimulateFaultMenu.vue";

const enabled = ref(true);
const simulations = ref<SimulationView[]>([]);
const simulate = vi.fn();
const restore = vi.fn();
mockNuxtImport("useSimulator", () => () => ({
  get enabled() {
    return enabled.value;
  },
  simulations,
  simulate,
  restore,
  refresh: vi.fn(),
}));

const offered: SubjectScenarios = {
  simulations: [],
  scenarios: [
    {
      id: "smart-health-failed",
      label: "SMART health failed",
      group: "Health",
      params: [],
    },
    {
      id: "pending-sectors",
      label: "Pending sectors",
      group: "SMART attributes",
      params: [
        { key: "raw", label: "Raw value", kind: "number", default: 8, min: 0 },
      ],
    },
  ],
};
registerEndpoint("/api/simulate/disk/7", () => offered);

const mounted: { unmount: () => void }[] = [];

async function mountMenu() {
  const component = await mountSuspended(SimulateFaultMenu, {
    props: { subjectType: "disk", subjectId: 7 },
    attachTo: document.body,
  });
  mounted.push(component);
  return component;
}

async function openMenu() {
  const component = await mountMenu();
  const trigger = component.get('[data-testid="simulate-fault"]');
  await trigger.trigger("keydown", { key: "Enter" });
  await flushPromises();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await flushPromises();
  return component;
}

const menuItem = (label: string) =>
  [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (element) => element.textContent?.trim() === label,
  );

beforeEach(() => {
  enabled.value = true;
  simulations.value = [];
  simulate.mockReset();
  restore.mockReset();
});

afterEach(() => {
  for (const component of mounted.splice(0)) component.unmount();
});

describe("SimulateFaultMenu", () => {
  it("renders nothing when the simulator is off", async () => {
    enabled.value = false;
    const component = await mountMenu();
    expect(component.find('[data-testid="simulate-fault"]').exists()).toBe(
      false,
    );
  });

  it("lists the subject's scenarios, marking those with params", async () => {
    await openMenu();
    expect(menuItem("SMART health failed")).toBeDefined();
    expect(menuItem("Pending sectors…")).toBeDefined();
    expect(menuItem("Restore (1 simulated)")).toBeUndefined();
  });

  it("runs a scenario without params straight away", async () => {
    await openMenu();
    menuItem("SMART health failed")?.click();
    await flushPromises();
    expect(simulate).toHaveBeenCalledWith("disk", 7, "smart-health-failed", {});
  });

  it("offers restore while simulations are active", async () => {
    simulations.value = [
      {
        id: 1,
        scenario: "smart-health-failed",
        label: "SMART health failed",
        subjectType: "disk",
        subjectId: 7,
        createdAt: "2026-10-02T12:00:00.000Z",
      },
    ];
    await openMenu();
    menuItem("Restore (1 simulated)")?.click();
    await flushPromises();
    expect(restore).toHaveBeenCalled();
  });
});

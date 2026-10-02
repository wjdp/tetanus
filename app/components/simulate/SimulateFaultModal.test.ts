// @vitest-environment nuxt
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { flushPromises } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import type { ScenarioView } from "#shared/simulator";
import SimulateFaultModal from "./SimulateFaultModal.vue";

const scenario: ScenarioView = {
  id: "leaf-fails",
  label: "Leaf fails",
  group: "State",
  description: "A disk in the pool fails.",
  params: [
    {
      key: "leaf",
      label: "Leaf",
      kind: "select",
      default: "sda",
      options: [
        { value: "sda", label: "sda" },
        { value: "sdb", label: "sdb" },
      ],
    },
    { key: "count", label: "Errors", kind: "number", default: 3, min: 0 },
  ],
};

describe("SimulateFaultModal", () => {
  it("submits the defaults unchanged", async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    await mountSuspended(SimulateFaultModal, {
      props: { scenario, run, open: true },
      attachTo: document.body,
    });
    await flushPromises();

    expect(document.body.textContent).toContain("Simulate: Leaf fails");
    expect(document.body.textContent).toContain("A disk in the pool fails.");
    document
      .querySelector<HTMLFormElement>("#simulate-fault-form")
      ?.requestSubmit();
    await flushPromises();

    expect(run).toHaveBeenCalledWith({ leaf: "sda", count: 3 });
  });
});

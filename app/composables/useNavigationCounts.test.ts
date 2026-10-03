// @vitest-environment nuxt
import { mountSuspended, registerEndpoint } from "@nuxt/test-utils/runtime";
import { flushPromises } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { clearNuxtData } from "#app";
import type { NavigationCounts } from "#shared/navigation";
import { emitSseEvent, FakeEventSource } from "~~/test/fakeEventSource";
import { useNavigationCounts } from "./useNavigationCounts";

let openErrors = 1;
registerEndpoint(
  "/api/navigation",
  (): NavigationCounts => ({
    faults: { error: openErrors, warning: 2, neutral: 0 },
    disks: { error: 0, warning: 1, neutral: 9 },
    pools: { error: 0, warning: 0, neutral: 3 },
    replications: { error: 0, warning: 0, neutral: 2 },
  }),
);

const mountProbe = async () => {
  const Probe = defineComponent({
    setup() {
      const counts = useNavigationCounts();
      return () =>
        h(
          "pre",
          `${counts.value.faults.error} ${counts.value.disks.neutral} ${counts.value.pools.neutral}`,
        );
    },
  });
  const component = await mountSuspended(Probe);
  await flushPromises();
  return component;
};

beforeEach(() => {
  FakeEventSource.install();
  clearNuxtData();
  openErrors = 1;
});

describe("useNavigationCounts", () => {
  it("exposes the counts from the API", async () => {
    expect((await mountProbe()).text()).toBe("1 9 3");
  });

  it("refreshes on the SSE faults event", async () => {
    const component = await mountProbe();
    openErrors = 4;

    emitSseEvent("faults", { at: new Date().toISOString() });
    await vi.waitFor(() => expect(component.text()).toBe("4 9 3"));
  });
});

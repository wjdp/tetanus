// @vitest-environment nuxt
import { mountSuspended, registerEndpoint } from "@nuxt/test-utils/runtime";
import { flushPromises } from "@vue/test-utils";
import { beforeEach, describe, expect, it } from "vitest";
import { defineComponent, h } from "vue";
import { clearNuxtData } from "#app";
import { useFaults } from "./useFaults";

const now = Date.now();
const run = (ageMs: number) => ({
  receivedAt: new Date(now - ageMs).toISOString(),
  ok: true,
  error: null,
  device: null,
});

const host = (
  lastRuns: Record<string, ReturnType<typeof run>>,
  collectorVersion: string | null = "0.3.1",
  intermittent = false,
) => ({
  id: 1,
  name: "mars",
  displayName: null,
  toolVersions: {},
  collectorVersion,
  collectorStatus: "current",
  healthchecksUrl: null,
  intermittent,
  position: 0,
  notes: "",
  firstSeenAt: new Date(now - 10 * 24 * 60 * 60_000).toISOString(),
  lastSeenAt: new Date(now - 5 * 60 * 60_000).toISOString(),
  lastRuns,
});

const FaultsProbe = defineComponent({
  setup() {
    const { faults } = useFaults();
    return () => h("pre", JSON.stringify(faults.value));
  },
});

// registerEndpoint's handler is re-read on every request, but a second call
// for the same URL does not replace the first within one test file, so both
// scenarios share one endpoint and switch on a mutable fixture instead.
let hosts: unknown[] = [];
registerEndpoint("/api/hosts", () => hosts);

beforeEach(() => {
  localStorage.clear();
  clearNuxtData();
});

describe("useFaults", () => {
  it("raises one fault for a host whose every group is stale", async () => {
    hosts = [host({ versions: run(5 * 60 * 60_000) })];

    const component = await mountSuspended(FaultsProbe);
    await flushPromises();

    expect(component.text()).toContain("collector-silent:mars");
    expect(component.text()).toContain('"host":"mars"');
    expect(component.text()).toContain("No data for");
  });

  it("raises no silent fault for an offline intermittent host", async () => {
    hosts = [host({ versions: run(5 * 60 * 60_000) }, "0.3.1", true)];

    const component = await mountSuspended(FaultsProbe);
    await flushPromises();

    expect(component.text()).toBe("[]");
  });

  it("still raises an incompatible fault for an offline host", async () => {
    hosts = [host({ versions: run(5 * 60 * 60_000) }, "0.2.0", true)];

    const component = await mountSuspended(FaultsProbe);
    await flushPromises();

    expect(component.text()).toContain("collector-incompatible:mars:0.2.0");
    expect(component.text()).not.toContain("collector-silent");
  });

  it("raises no fault when a group is fresh", async () => {
    hosts = [host({ versions: run(60_000) })];

    const component = await mountSuspended(FaultsProbe);
    await flushPromises();

    expect(component.text()).toBe("[]");
  });

  it("raises a fault for an incompatible collector", async () => {
    hosts = [host({ versions: run(60_000) }, "0.2.0")];

    const component = await mountSuspended(FaultsProbe);
    await flushPromises();

    expect(component.text()).toContain("collector-incompatible:mars:0.2.0");
    expect(component.text()).toContain('"host":"mars"');
    expect(component.text()).toContain(
      "Collector 0.2.0 is too old; 0.3.0 or later is needed",
    );
    expect(component.text()).toContain("/host/install.sh | sudo bash");
  });

  it.each(["0.3.0", null])(
    "raises no fault for collector %s",
    async (version) => {
      hosts = [host({ versions: run(60_000) }, version)];

      const component = await mountSuspended(FaultsProbe);
      await flushPromises();

      expect(component.text()).toBe("[]");
    },
  );
});

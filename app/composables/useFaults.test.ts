// @vitest-environment nuxt
import { mountSuspended, registerEndpoint } from "@nuxt/test-utils/runtime";
import { flushPromises } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { clearNuxtData } from "#app";
import type { FaultsResponse } from "#shared/faults";
import { emitSseEvent, FakeEventSource } from "~~/test/fakeEventSource";
import { type FaultsQuery, useFaults } from "./useFaults";

const response = (open: number): FaultsResponse => ({
  faults: [],
  counts: { open, acknowledged: 1, accepted: 0, resolved: 2 },
});

const listRequests: Record<string, unknown>[] = [];
let open = 1;
registerEndpoint("/api/faults", (event) => {
  listRequests.push(
    Object.fromEntries(new URL(event.path, "http://x").searchParams),
  );
  return response(open);
});

const actionRequests: string[] = [];
const recordAction = (label: string) => (event: { method: string }) => {
  actionRequests.push(`${event.method} ${label}`);
  return {};
};
registerEndpoint("/api/faults/7/acknowledge", {
  method: "POST",
  handler: recordAction("acknowledge"),
});
registerEndpoint("/api/faults/7/accept", {
  method: "POST",
  handler: recordAction("accept"),
});
registerEndpoint("/api/faults/7/acknowledgement", {
  method: "DELETE",
  handler: recordAction("acknowledgement"),
});

const mountProbe = async (query: FaultsQuery = {}) => {
  let api!: ReturnType<typeof useFaults>;
  const Probe = defineComponent({
    setup() {
      api = useFaults(query);
      return () =>
        h("pre", `${api.counts.value.open} ${api.counts.value.resolved}`);
    },
  });
  const component = await mountSuspended(Probe);
  await flushPromises();
  return { component, api };
};

beforeEach(() => {
  FakeEventSource.install();
  clearNuxtData();
  listRequests.length = 0;
  actionRequests.length = 0;
  open = 1;
});

describe("useFaults", () => {
  it("exposes the counts from the API", async () => {
    const { component } = await mountProbe();

    expect(component.text()).toBe("1 2");
  });

  it("passes the query through", async () => {
    await mountProbe({ state: "open", severity: "error" });

    expect(listRequests.at(-1)).toEqual({ state: "open", severity: "error" });
  });

  it("refreshes on the SSE faults event", async () => {
    const { component } = await mountProbe();
    open = 3;

    emitSseEvent("faults", { at: new Date().toISOString() });
    await vi.waitFor(() => expect(component.text()).toBe("3 2"));
  });

  it("calls the action endpoints, then refreshes", async () => {
    const { api } = await mountProbe();
    const before = listRequests.length;

    await api.acknowledge(7, "looking");
    await api.accept(7);
    await api.clear(7);

    expect(actionRequests).toEqual([
      "POST acknowledge",
      "POST accept",
      "DELETE acknowledgement",
    ]);
    expect(listRequests.length).toBe(before + 3);
  });
});

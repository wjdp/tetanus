// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from "@nuxt/test-utils/runtime";
import { describe, expect, it } from "vitest";
import { computed } from "vue";
import DiskFaults from "./DiskFaults.vue";

const fault = (id: number, state: string) => ({
  id,
  kind: "smart-counters-reset",
  category: "disk",
  severity: "warning",
  state,
  subject: { type: "disk", id: 7, label: "Q1", hostName: "mars" },
  data: {},
  openedAt: "2026-10-05T10:00:00.000Z",
  lastSeenAt: "2026-10-05T10:00:00.000Z",
  stateChangedAt: "2026-10-05T10:00:00.000Z",
  resolvedAt: state === "resolved" ? "2026-10-05T11:00:00.000Z" : null,
  note: "",
  actions: [],
});

const requested: string[] = [];

mockNuxtImport("useFaults", () => (query: () => Record<string, string>) => {
  const { state, subject } = query();
  requested.push(`${subject}|${state}`);
  const faults =
    subject === "disk:8"
      ? []
      : state === "resolved"
        ? [fault(2, "resolved")]
        : [fault(1, "open")];
  return {
    faults: computed(() => faults),
    refresh: async () => {},
    perform: async () => {},
  };
});

describe("DiskFaults", () => {
  it("lists the disk's live faults and its recently resolved ones", async () => {
    const component = await mountSuspended(DiskFaults, {
      props: { diskId: 7 },
    });
    expect(requested).toContain("disk:7|open,acknowledged,accepted");
    expect(requested).toContain("disk:7|resolved");
    const lists = component.findAll('[data-testid="fault-list"]');
    expect(lists).toHaveLength(2);
    expect(lists[0]?.text()).toContain("SMART counters reset");
    expect(lists[1]?.text()).toContain("SMART counters reset");
  });

  it("says so when there are no faults", async () => {
    const component = await mountSuspended(DiskFaults, {
      props: { diskId: 8 },
    });
    expect(component.find('[data-testid="disk-faults-none"]').exists()).toBe(
      true,
    );
    expect(component.findAll('[data-testid="fault-list"]')).toHaveLength(0);
  });
});

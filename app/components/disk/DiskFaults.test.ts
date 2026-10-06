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

const poolFault = {
  ...fault(3, "open"),
  kind: "leaf-errors",
  category: "zfs",
  subject: {
    type: "pool",
    id: 4,
    label: "tank",
    hostName: "mars",
    path: "/hosts/mars/pools/tank",
  },
  data: {
    poolName: "tank",
    name: "/dev/disk/by-vdev/A1",
    role: "normal",
    diskId: 7,
    read: 0,
    write: 0,
    checksum: 3,
    total: { read: 0, write: 0, checksum: 3 },
  },
};

mockNuxtImport("useFaults", () => (query: () => Record<string, string>) => {
  const { state, subject, namesDisk } = query();
  requested.push(
    namesDisk ? `names:${namesDisk}|${state}` : `${subject}|${state}`,
  );
  const faults = namesDisk
    ? namesDisk === "7"
      ? [poolFault]
      : []
    : subject === "disk:8"
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
    expect(lists).toHaveLength(3);
    expect(lists[0]?.text()).toContain("SMART counters reset");
    expect(lists[2]?.text()).toContain("SMART counters reset");
    expect(lists[0]?.text()).not.toContain("mars");
  });

  it("lists live pool faults naming the disk, linked to the pool", async () => {
    const component = await mountSuspended(DiskFaults, {
      props: { diskId: 7 },
    });
    expect(requested).toContain("names:7|open,acknowledged,accepted");
    const section = component.find('[data-testid="disk-pool-faults"]');
    expect(section.text()).toContain("Pool faults naming this disk");
    expect(section.text()).toContain("tank");
    expect(section.find('a[href="/hosts/mars/pools/tank"]').exists()).toBe(
      true,
    );
  });

  it("says so when there are no faults", async () => {
    const component = await mountSuspended(DiskFaults, {
      props: { diskId: 8 },
    });
    expect(component.find('[data-testid="disk-faults-none"]').exists()).toBe(
      true,
    );
    expect(component.findAll('[data-testid="fault-list"]')).toHaveLength(0);
    expect(component.find('[data-testid="disk-pool-faults"]').exists()).toBe(
      false,
    );
  });
});

// @vitest-environment nuxt
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { describe, expect, it, vi } from "vitest";
import type { FaultView } from "#shared/faults";
import FaultRow from "./FaultRow.vue";

const NOW = Date.parse("2026-10-02T12:00:00.000Z");

const leafFault = (data: FaultView["data"]): FaultView => ({
  id: 1,
  kind: "leaf-errors",
  category: "zfs",
  severity: "warning",
  state: "open",
  key: "3:1234",
  data,
  note: "",
  openedAt: "2026-10-01T10:00:00.000Z",
  lastSeenAt: "2026-10-02T10:00:00.000Z",
  resolvedAt: null,
  stateChangedAt: "2026-10-01T10:00:00.000Z",
  subject: { type: "pool", id: 3, label: "tank", hostName: "mars" },
});

const mountRow = (fault: FaultView) =>
  mountSuspended(FaultRow, {
    props: { fault, now: NOW, upgradeCommand: "", perform: vi.fn() },
  });

describe("FaultRow", () => {
  it("links a leaf fault to its pool and its disk", async () => {
    const row = await mountRow(
      leafFault({
        poolName: "tank",
        name: "/dev/disk/by-vdev/A7-part1",
        diskId: 12,
        read: 0,
        write: 0,
        checksum: 12,
        rise24h: 4,
      }),
    );

    expect(
      row.get('[data-testid="fault-subject-link"]').attributes("href"),
    ).toBe("/zfs/3");
    expect(row.text()).toContain("A7-part1 in tank: R 0 W 0 C 12, +4 in 24 h");
    const disk = row.get('[data-testid="fault-disk-link"]');
    expect(disk.attributes("href")).toBe("/disks/12");
    expect(disk.text()).toBe("Disk");
  });

  it("has no disk link for an unlinked leaf", async () => {
    const row = await mountRow(
      leafFault({ poolName: "tank", name: "/tmp/f1", diskId: null }),
    );
    expect(row.find('[data-testid="fault-disk-link"]').exists()).toBe(false);
  });
});

// @vitest-environment nuxt
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { describe, expect, it, vi } from "vitest";
import type { FaultView } from "#shared/faults";
import FaultActions from "./FaultActions.vue";

const poolFault = (overrides: Partial<FaultView>): FaultView => ({
  id: 1,
  kind: "pool-missing",
  category: "zfs",
  severity: "warning",
  state: "open",
  key: "9",
  data: { poolName: "tfault", lastSeenAt: "2026-10-01T09:00:00.000Z" },
  note: "",
  openedAt: "2026-10-01T10:00:00.000Z",
  lastSeenAt: "2026-10-02T10:00:00.000Z",
  resolvedAt: null,
  stateChangedAt: "2026-10-01T10:00:00.000Z",
  subject: {
    type: "pool",
    id: 9,
    label: "tfault",
    hostName: "mars",
    path: null,
  },
  ...overrides,
});

const buttonLabels = async (fault: FaultView) => {
  const actions = await mountSuspended(FaultActions, {
    props: { fault, perform: vi.fn() },
  });
  return actions.findAll("button").map((button) => button.text());
};

describe("FaultActions", () => {
  it("offers to archive a missing pool", async () => {
    expect(await buttonLabels(poolFault({}))).toContain("Archive pool");
  });

  it("offers no archive for other pool faults", async () => {
    expect(
      await buttonLabels(
        poolFault({ kind: "pool-degraded", data: { state: "DEGRADED" } }),
      ),
    ).not.toContain("Archive pool");
  });

  it("asks for confirmation before resolving", async () => {
    const perform = vi.fn();
    const actions = await mountSuspended(FaultActions, {
      props: {
        fault: poolFault({ kind: "leaf-errors", data: {} }),
        perform,
      },
    });
    const resolve = actions
      .findAll("button")
      .find((button) => button.text() === "Resolve");
    await resolve?.trigger("click");
    expect(perform).not.toHaveBeenCalled();
  });
});

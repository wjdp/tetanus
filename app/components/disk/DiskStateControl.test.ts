// @vitest-environment nuxt
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { describe, expect, it } from "vitest";
import LifecycleBadge from "../LifecycleBadge.vue";
import DiskStateControl from "./DiskStateControl.vue";
import type { DiskDetail } from "./types";

const disk = (overrides: Partial<DiskDetail>) =>
  ({
    id: 7,
    state: "in-use",
    inferredState: "in-use",
    stateOverride: null,
    usage: { kind: "zfs", fsTypes: [], mounts: [], system: false },
    membership: null,
    purpose: null,
    purposeInferred: false,
    ...overrides,
  }) as unknown as DiskDetail;

const lifecycleBadge = "[data-state]";

describe("DiskStateControl", () => {
  it("shows the inferred state as a subtle lifecycle badge", async () => {
    const control = await mountSuspended(DiskStateControl, {
      props: { disk: disk({}) },
    });

    const badge = control.get(lifecycleBadge);
    expect(badge.attributes("data-state")).toBe("in-use");
    expect(badge.text()).toBe("In use");
    expect(badge.attributes("title")).toBeUndefined();
    expect(control.getComponent(LifecycleBadge).props("overridden")).toBe(
      false,
    );
    expect(control.text()).not.toContain("inferred");
  });

  it("outlines an overridden state and notes what was inferred", async () => {
    const control = await mountSuspended(DiskStateControl, {
      props: {
        disk: disk({ state: "dead", stateOverride: "dead" }),
      },
    });

    const badge = control.get(lifecycleBadge);
    expect(badge.attributes("data-state")).toBe("dead");
    expect(badge.text()).toBe("Dead");
    expect(badge.attributes("title")).toBe("set by hand");
    expect(badge.html()).toContain("i-lucide:skull");
    expect(control.getComponent(LifecycleBadge).props("overridden")).toBe(true);
    expect(control.text()).toContain("inferred in-use");
  });
});

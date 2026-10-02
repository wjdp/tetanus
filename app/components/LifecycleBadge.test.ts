// @vitest-environment nuxt
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { describe, expect, it } from "vitest";
import LifecycleBadge from "./LifecycleBadge.vue";

describe("LifecycleBadge", () => {
  it("shows the state's label and icon", async () => {
    const badge = await mountSuspended(LifecycleBadge, {
      props: { state: "dead" },
    });

    expect(badge.text()).toBe("Dead");
    expect(badge.html()).toContain("i-lucide:skull");
    expect(badge.attributes("title")).toBeUndefined();
  });

  it("marks an override as set by hand", async () => {
    const badge = await mountSuspended(LifecycleBadge, {
      props: { state: "retired", overridden: true },
    });

    expect(badge.attributes("title")).toBe("set by hand");
  });

  it("mutes a state judged as of an old scan", async () => {
    const asOf = new Date(Date.now() - 9 * 24 * 60 * 60 * 1000).toISOString();
    const badge = await mountSuspended(LifecycleBadge, {
      props: { state: "in-use", asOf },
    });

    expect(badge.attributes("title")).toBe("as of last scan 9 d ago");
    expect(badge.attributes("data-stale")).toBe("true");
    expect(badge.classes()).toContain("opacity-60");
  });

  it("lets an override win over a stale scan", async () => {
    const badge = await mountSuspended(LifecycleBadge, {
      props: {
        state: "spare",
        overridden: true,
        asOf: new Date(0).toISOString(),
      },
    });

    expect(badge.attributes("title")).toBe("set by hand");
    expect(badge.attributes("data-stale")).toBeUndefined();
  });
});

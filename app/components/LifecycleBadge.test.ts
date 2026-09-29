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
});

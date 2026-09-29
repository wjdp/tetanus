// @vitest-environment nuxt
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { describe, expect, it } from "vitest";
import StatusDot from "./StatusDot.vue";

describe("TopologyStatusDot", () => {
  it("is filled by default", async () => {
    const dot = await mountSuspended(StatusDot, {
      props: { colour: "success" },
    });

    expect(dot.attributes("data-shape")).toBe("filled");
    expect(dot.attributes("data-colour")).toBe("success");
    expect(dot.classes()).toContain("bg-success");
  });

  it("draws a hollow ring in the same colour", async () => {
    const dot = await mountSuspended(StatusDot, {
      props: { colour: "warning", shape: "hollow" },
    });

    expect(dot.attributes("data-shape")).toBe("hollow");
    expect(dot.classes()).toEqual(
      expect.arrayContaining(["size-2", "border-2", "border-warning"]),
    );
    expect(dot.classes()).not.toContain("bg-warning");
  });
});

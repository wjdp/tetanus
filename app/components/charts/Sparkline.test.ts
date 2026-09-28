// @vitest-environment nuxt
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { describe, expect, it } from "vitest";
import Sparkline from "./Sparkline.vue";

describe("Sparkline", () => {
  it("renders a polyline through the points", async () => {
    const component = await mountSuspended(Sparkline, {
      props: { values: [0, 10] },
    });

    expect(component.get("polyline").attributes("points")).toBe("0,19 80,1");
  });

  it("renders no line without values", async () => {
    const component = await mountSuspended(Sparkline, {
      props: { values: [] },
    });

    expect(component.find("polyline").exists()).toBe(false);
  });
});

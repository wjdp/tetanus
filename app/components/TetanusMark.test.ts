// @vitest-environment nuxt
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { describe, expect, it } from "vitest";
import TetanusMark from "./TetanusMark.vue";

describe("TetanusMark", () => {
  it("renders platter, hub and track", async () => {
    const component = await mountSuspended(TetanusMark);

    expect(component.findAll("circle")).toHaveLength(2);
    expect(component.find("path").exists()).toBe(true);
  });

  it("gives the track the primary stroke class", async () => {
    const component = await mountSuspended(TetanusMark);

    expect(component.find("path").classes()).toContain("stroke-primary");
  });

  it("sizes the svg from the size prop", async () => {
    const component = await mountSuspended(TetanusMark, {
      props: { size: 48 },
    });

    expect(component.find("svg").attributes("width")).toBe("48");
  });
});

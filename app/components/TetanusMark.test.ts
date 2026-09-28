// @vitest-environment nuxt
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { describe, expect, it } from "vitest";
import TetanusMark from "./TetanusMark.vue";

describe("TetanusMark", () => {
  it("renders the arm by default", async () => {
    const component = await mountSuspended(TetanusMark);

    expect(component.find("path").exists()).toBe(true);
  });

  it("omits the arm when arm is false", async () => {
    const component = await mountSuspended(TetanusMark, {
      props: { arm: false },
    });

    expect(component.find("path").exists()).toBe(false);
  });

  it("gives the head the primary fill class", async () => {
    const component = await mountSuspended(TetanusMark);

    const head = component.findAll("circle").at(-1);
    expect(head?.classes()).toContain("fill-primary");
  });
});

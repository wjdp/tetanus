// @vitest-environment nuxt
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { describe, expect, it } from "vitest";
import VdevTypeIcon from "./VdevTypeIcon.vue";

describe("VdevTypeIcon", () => {
  it("renders the icon for a known type", async () => {
    const icon = await mountSuspended(VdevTypeIcon, {
      props: { type: "mirror" },
    });

    expect(icon.attributes("data-vdev-type")).toBe("mirror");
    expect(icon.html()).toContain("i-lucide:copy");
  });

  it("renders nothing for an unknown type", async () => {
    const icon = await mountSuspended(VdevTypeIcon, {
      props: { type: "draid2" },
    });

    expect(icon.find("[data-vdev-type]").exists()).toBe(false);
  });
});

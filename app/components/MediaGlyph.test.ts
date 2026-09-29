// @vitest-environment nuxt
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { describe, expect, it } from "vitest";
import MediaGlyph from "./MediaGlyph.vue";

describe("MediaGlyph", () => {
  it("draws the hdd platter without the rust track", async () => {
    const glyph = await mountSuspended(MediaGlyph, {
      props: { media: "hdd" },
    });

    expect(glyph.findAll("circle")).toHaveLength(2);
    expect(glyph.find("path").exists()).toBe(false);
    expect(glyph.html()).toMatchSnapshot();
  });

  it("draws the ssd microchip at 16 px", async () => {
    const glyph = await mountSuspended(MediaGlyph, {
      props: { media: "ssd" },
    });

    expect(glyph.attributes("style")).toContain("width: 16px");
    expect(glyph.html()).toMatchSnapshot();
  });

  it("sizes the platter from the size prop", async () => {
    const glyph = await mountSuspended(MediaGlyph, {
      props: { media: "hdd", size: 20 },
    });

    expect(glyph.find("svg").attributes("width")).toBe("20");
  });

  it.each(["unknown", null] as const)(
    "renders nothing for %s",
    async (media) => {
      const glyph = await mountSuspended(MediaGlyph, { props: { media } });

      expect(glyph.find("svg").exists()).toBe(false);
      expect(glyph.find("[data-media]").exists()).toBe(false);
    },
  );
});

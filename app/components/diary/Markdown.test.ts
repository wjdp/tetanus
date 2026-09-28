// @vitest-environment nuxt
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { describe, expect, it } from "vitest";
import Markdown from "./Markdown.vue";

describe("DiaryMarkdown", () => {
  it("renders paragraphs and links", async () => {
    const wrapper = await mountSuspended(Markdown, {
      props: {
        source:
          "First paragraph.\n\nSee [the RMA](https://example.com/rma) and https://example.org.",
      },
    });

    expect(wrapper.findAll("p").map((p) => p.text())).toEqual([
      "First paragraph.",
      "See the RMA and https://example.org.",
    ]);
    expect(wrapper.find('a[href="https://example.com/rma"]').text()).toBe(
      "the RMA",
    );
    expect(wrapper.find('a[href="https://example.org"]').exists()).toBe(true);
  });

  it("escapes raw HTML", async () => {
    const wrapper = await mountSuspended(Markdown, {
      props: { source: '<script>alert("x")</script><b>bold</b>' },
    });

    expect(wrapper.find("script").exists()).toBe(false);
    expect(wrapper.find("b").exists()).toBe(false);
    expect(wrapper.text()).toContain("<b>bold</b>");
  });
});

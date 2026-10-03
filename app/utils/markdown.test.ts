import { describe, expect, it } from "vitest";
import { markdownToPlainText } from "./markdown";

describe("markdownToPlainText", () => {
  it("drops emphasis, links and headings, keeping their text", () => {
    expect(
      markdownToPlainText(
        "# Bought\n\nFrom **eBay**, see [listing](https://example.com).",
      ),
    ).toBe("Bought From eBay, see listing.");
  });

  it("flattens lists and line breaks to single spaces", () => {
    expect(markdownToPlainText("- one\n- two\nthree\n\n`sdc`")).toBe(
      "one two three sdc",
    );
  });

  it("keeps code block content", () => {
    expect(markdownToPlainText("```\nsmartctl -a\n```")).toBe("smartctl -a");
  });

  it("returns an empty string for blank notes", () => {
    expect(markdownToPlainText("  \n ")).toBe("");
  });
});

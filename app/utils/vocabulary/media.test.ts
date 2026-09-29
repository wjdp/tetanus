import { describe, expect, it } from "vitest";
import { MEDIA } from "#shared/hardware";
import { MEDIA_GLYPH, mediaGlyph } from "./media";

describe("mediaGlyph", () => {
  it.each(MEDIA)("has an entry for %s", (media) => {
    expect(MEDIA_GLYPH).toHaveProperty(media);
  });

  it("draws hdd as the platter", () => {
    expect(mediaGlyph("hdd")).toEqual({ kind: "platter" });
  });

  it("draws ssd as a microchip", () => {
    expect(mediaGlyph("ssd")).toEqual({
      kind: "icon",
      name: "i-lucide-microchip",
    });
  });

  it.each(["unknown", null, undefined] as const)(
    "draws nothing for %s",
    (media) => {
      expect(mediaGlyph(media)).toBeNull();
    },
  );
});

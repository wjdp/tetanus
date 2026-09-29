import type { Media } from "#shared/hardware";

export type MediaGlyphDescriptor =
  | { kind: "platter" }
  | { kind: "icon"; name: "i-lucide-microchip" }
  | null;

export const MEDIA_GLYPH: Record<Media, MediaGlyphDescriptor> = {
  hdd: { kind: "platter" },
  ssd: { kind: "icon", name: "i-lucide-microchip" },
  unknown: null,
};

export const mediaGlyph = (
  media: Media | null | undefined,
): MediaGlyphDescriptor => (media ? MEDIA_GLYPH[media] : null);

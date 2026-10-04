export const PAGE_BACKGROUND = { light: "#ffffff", dark: "#1c1917" } as const;

export const ICON_BACKGROUND = "#0c0a09";

export function themeColourMeta(mode: "light" | "dark" | "system") {
  return (["light", "dark"] as const).map((scheme) => ({
    name: "theme-color",
    content: PAGE_BACKGROUND[mode === "system" ? scheme : mode],
    media: `(prefers-color-scheme: ${scheme})`,
  }));
}

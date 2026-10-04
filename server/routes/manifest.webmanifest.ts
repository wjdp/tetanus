import { APP_NAME } from "#shared/app";
import { ICON_BACKGROUND, PAGE_BACKGROUND } from "#shared/themeColours";

export default defineEventHandler((event) => {
  setResponseHeader(event, "Content-Type", "application/manifest+json");
  return {
    name: APP_NAME,
    short_name: APP_NAME,
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: ICON_BACKGROUND,
    theme_color: PAGE_BACKGROUND.dark,
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
});

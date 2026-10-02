// https://nuxt.com/docs/api/configuration/nuxt-config
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";

import { version } from "./package.json";
import { APP_NAME } from "./shared/app";

const relaxedIndexAccess = () => ({
  compilerOptions: { noUncheckedIndexedAccess: false },
});

// `test/` sits outside every project Nuxt generates, so its files are only
// checked where an app or server file happens to import them.
const rootDirsOutsideNuxtProjects = ["../test/**/*"];

export default defineNuxtConfig({
  extends:
    process.env.TETANUS_TARGET === "cloudflare" ? ["./deploy/cloudflare"] : [],
  compatibilityDate: "2026-09-28",
  buildDir: ".nuxt",
  typescript: {
    tsConfig: {
      ...relaxedIndexAccess(),
      include: rootDirsOutsideNuxtProjects,
    },
    nodeTsConfig: relaxedIndexAccess(),
    sharedTsConfig: relaxedIndexAccess(),
  },
  devtools: { enabled: true },
  modules: ["@nuxt/test-utils/module", "@nuxt/ui"],
  css: ["~/assets/css/main.css"],
  // Helper modules live beside their components; only .vue files are components.
  components: [{ path: "~/components", extensions: ["vue"] }],
  runtimeConfig: {
    public: {
      version: version + (process.env.VERSION_SUFFIX ?? ""),
      demo: false,
      faultSimulator: false,
    },
  },
  fonts: {
    defaults: {
      weights: [400, 500, 600, 700],
      styles: ["normal"],
      subsets: ["latin"],
      preload: true,
    },
    families: [
      { name: "Inter", provider: "google", styles: ["normal", "italic"] },
      { name: "JetBrains Mono", provider: "google" },
    ],
  },
  nitro: {
    typescript: { tsConfig: relaxedIndexAccess() },
    experimental: { tasks: true },
    esbuild: { options: { target: "es2022" } },
    serverAssets: [
      {
        baseName: "host",
        dir: fileURLToPath(new URL("host", import.meta.url)),
      },
    ],
    scheduledTasks: { "*/5 * * * *": ["alerts:tick", "healthchecks:ping"] },
    ignore: ["**/*.test.ts"],
  },
  vite: {
    plugins: [tailwindcss()],
    server: {
      watch: {
        ignored: ["*.db", "tmp/**"],
      },
    },
  },
  app: {
    head: {
      title: APP_NAME,
      link: [
        { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
        {
          rel: "icon",
          type: "image/png",
          sizes: "32x32",
          href: "/favicon-32.png",
        },
        {
          rel: "apple-touch-icon",
          sizes: "180x180",
          href: "/apple-touch-icon.png",
        },
      ],
    },
  },
});

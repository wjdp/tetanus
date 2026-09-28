// https://nuxt.com/docs/api/configuration/nuxt-config
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
  runtimeConfig: {
    public: { version: version + (process.env.VERSION_SUFFIX ?? "") },
  },
  fonts: {
    families: [
      { name: "Inter", provider: "google" },
      { name: "JetBrains Mono", provider: "google" },
    ],
  },
  nitro: {
    typescript: { tsConfig: relaxedIndexAccess() },
    experimental: { tasks: true },
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
    },
  },
});

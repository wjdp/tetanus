import { fileURLToPath } from "node:url";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineNuxtConfig({
  nitro: {
    preset: "cloudflare-module",
    cloudflare: { nodeCompat: true },
    alias: {
      "~~/server/database/client": here("./client.ts"),
      "~~/server/database/migrate": here("./migrate.ts"),
    },
    ignore: ["routes/host/**"],
  },
  hooks: {
    // Layers merge under the root config, so settings the root already sets
    // have to be overridden here rather than declared above.
    "nitro:config"(nitro) {
      nitro.scheduledTasks = {};
      nitro.serverAssets = nitro.serverAssets?.filter(
        (asset) => asset.baseName !== "host",
      );
      if (nitro.runtimeConfig?.public) nitro.runtimeConfig.public.demo = true;
    },
  },
});

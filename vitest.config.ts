import { fileURLToPath } from "node:url";
import { defineVitestProject } from "@nuxt/test-utils/config";
import { defineConfig } from "vitest/config";

const rootAlias = {
  "~~": fileURLToPath(new URL(".", import.meta.url)),
  "#shared": fileURLToPath(new URL("./shared", import.meta.url)),
};

export default defineConfig({
  test: {
    silent: "passed-only",
    // Each worker of the Nuxt project loads the whole Nuxt/Vite plugin stack
    // (~1.5 GB); the default of one worker per two cores exhausts RAM.
    maxWorkers: 4,
    projects: [
      {
        // Server and shared code needs no Nuxt runtime, so it runs in plain
        // Node workers that are a fraction of the size of the Nuxt ones.
        resolve: { alias: rootAlias },
        test: {
          name: "unit",
          include: ["server/**/*.test.ts", "shared/**/*.test.ts"],
          setupFiles: ["test/setup.ts"],
          env: {
            DATABASE_URL: ":memory:",
          },
        },
      },
      await defineVitestProject({
        test: {
          name: "app",
          include: ["app/**/*.test.ts"],
        },
      }),
      {
        // The e2e suites boot their own `nuxt dev` servers from this cwd and
        // seed their own file databases, so they run outside the Nuxt test
        // environment. Booting one server at a time avoids two racing over
        // the shared .nuxt build; the second reuses the first's warm cache.
        resolve: { alias: rootAlias },
        test: {
          name: "e2e",
          include: ["test/api/**/*.e2e.test.ts"],
          fileParallelism: false,
          env: {
            DATABASE_URL: ":memory:",
          },
        },
      },
    ],
  },
});

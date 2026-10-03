import { fileURLToPath } from "node:url";
import { defineVitestProject } from "@nuxt/test-utils/config";
import { configDefaults, defineConfig } from "vitest/config";

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
          exclude: [...configDefaults.exclude, "**/*.seeded.test.ts"],
          setupFiles: ["test/setup.ts"],
          env: {
            DATABASE_URL: ":memory:",
          },
        },
      },
      {
        // Integration tests over the demo fleet. Seeding takes ~20s, so global
        // setup starts it once per run in the background and each file waits
        // for it, then copies the result.
        resolve: { alias: rootAlias },
        test: {
          name: "seeded",
          include: ["server/**/*.seeded.test.ts"],
          globalSetup: ["test/seed.globalSetup.ts"],
          hookTimeout: 180_000,
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
          setupFiles: ["test/appSetup.ts"],
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

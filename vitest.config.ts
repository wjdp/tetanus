import { fileURLToPath } from "node:url";
import { defineVitestProject } from "@nuxt/test-utils/config";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    silent: "passed-only",
    projects: [
      await defineVitestProject({
        test: {
          name: "unit",
          setupFiles: ["test/setup.ts"],
          exclude: ["**/node_modules/**", ".claude/**", "test/api/**"],
          env: {
            DATABASE_URL: ":memory:",
          },
        },
      }),
      {
        // The e2e suites boot their own `nuxt dev` servers from this cwd and
        // seed their own file databases, so they run outside the Nuxt test
        // environment. Booting one server at a time avoids two racing over
        // the shared .nuxt build; the second reuses the first's warm cache.
        resolve: {
          alias: {
            "~~": fileURLToPath(new URL(".", import.meta.url)),
          },
        },
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

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestProject } from "vitest/node";
import { SEEDED_AT } from "./seeded";

/**
 * Starts seeding the demo fleet once per run, in a child process so other tests
 * run meanwhile. Each seeded test file waits for it and copies it into its own
 * `:memory:` database with `loadSeededDatabase`.
 */
export default function setup(project: TestProject) {
  const directory = mkdtempSync(join(tmpdir(), "tetanus-seed-"));
  const path = join(directory, "seed.db");
  const child = spawn(
    join(project.config.root, "node_modules/.bin/tsx"),
    [
      "--tsconfig",
      ".nuxt/tsconfig.server.json",
      "test/seed.script.ts",
      path,
      SEEDED_AT.toISOString(),
    ],
    { cwd: project.config.root, stdio: "inherit" },
  );
  child.on("exit", (code) => {
    if (code !== 0) writeFileSync(`${path}.failed`, `exit ${code}`);
  });
  project.provide("seededDatabasePath", path);
  return () => {
    child.kill();
    rmSync(directory, { recursive: true, force: true });
  };
}

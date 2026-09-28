import { readFileSync } from "node:fs";
import { join } from "node:path";

const FIXTURES_ROOT = join(import.meta.dirname, "fixtures");

export function readFixture(relativePath: string): string {
  return readFileSync(join(FIXTURES_ROOT, relativePath), "utf8");
}

export function readFixtureExit(relativePath: string): number {
  const exitPath = relativePath.replace(/\.[^./]+$/, ".exit");
  return Number(readFileSync(join(FIXTURES_ROOT, exitPath), "utf8").trim());
}

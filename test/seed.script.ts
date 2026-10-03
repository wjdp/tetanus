import { renameSync, writeFileSync } from "node:fs";

// Run by seed.globalSetup.ts in a child process, so seeding overlaps other tests.
const [path, seededAt] = process.argv.slice(2) as [string, string];
const building = `${path}.building`;
process.env.DATABASE_URL = building;

await import("./setup");
const { seed } = await import("~~/server/demo/seed");
const { sqlite } = await import("~~/server/database/client");

const report = await seed(new Date(seededAt), { replay: "short" });
sqlite.close();
writeFileSync(`${path}.report.json`, JSON.stringify(report));
renameSync(building, path);

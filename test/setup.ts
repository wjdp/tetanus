import { db, sqlite } from "~~/server/database/client";
import { runMigrations } from "~~/server/database/migrate";

// Services reach for Nitro's auto-imported runtime config; unit tests run in
// plain Node, so a mutable stand-in lets them toggle demo mode.
const runtimeConfig = { public: { demo: false, faultSimulator: false } };
Object.assign(globalThis, { useRuntimeConfig: () => runtimeConfig });

// Each test file gets its own module graph, hence its own :memory: database.
runMigrations(sqlite, db);

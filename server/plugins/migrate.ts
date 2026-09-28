import { databasePath, db, sqlite } from "~~/server/database/client";
import { describeMigrations, runMigrations } from "~~/server/database/migrate";
import { ensureSettings } from "~~/server/services/settings";
import { applySmartPolicyIfStale } from "~~/server/services/smartPolicy";

export default defineNitroPlugin(() => {
  try {
    if (!import.meta.dev) {
      const report = runMigrations(sqlite, db);
      console.log(describeMigrations(report, databasePath()));
    }
    ensureSettings();
    applySmartPolicyIfStale();
  } catch (error) {
    if (import.meta.dev) {
      console.warn("Database start-up skipped; run pnpm db:migrate", error);
      return;
    }
    console.error("Database start-up failed", error);
    throw error;
  }
});

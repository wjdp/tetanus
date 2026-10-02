import { databasePath, db, sqlite } from "~~/server/database/client";
import { describeMigrations, runMigrations } from "~~/server/database/migrate";
import { ensureSettings } from "~~/server/services/settings";
import { applySmartPolicyIfStale } from "~~/server/services/smartPolicy";
import { enqueueUnlessPending } from "~~/server/tasks/queueable/alertsTick";
import { isDemo } from "~~/server/utils/demo";

async function queueFaultsBackfill() {
  try {
    await enqueueUnlessPending("faults:backfill");
  } catch (error) {
    console.error("Could not queue faults:backfill", error);
  }
}

export default defineNitroPlugin(() => {
  try {
    if (!import.meta.dev) {
      const report = runMigrations(sqlite, db);
      console.log(describeMigrations(report, databasePath()));
    }
    const settings = ensureSettings();
    applySmartPolicyIfStale();
    if (!settings.config.faultsBackfilledAt && !isDemo()) {
      void queueFaultsBackfill();
    }
  } catch (error) {
    if (import.meta.dev) {
      console.warn("Database start-up skipped; run pnpm db:migrate", error);
      return;
    }
    console.error("Database start-up failed", error);
    throw error;
  }
});

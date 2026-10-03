import type { TaskName } from "#shared/tasks";
import { databasePath, db, sqlite } from "~~/server/database/client";
import { describeMigrations, runMigrations } from "~~/server/database/migrate";
import { backfillAtaSsdAttributesOnce } from "~~/server/services/ataSsdAttributesBackfill";
import { ensureSettings } from "~~/server/services/settings";
import { applySmartPolicyIfStale } from "~~/server/services/smartPolicy";
import { enqueueUnlessPending } from "~~/server/tasks/queueable/alertsTick";
import { isDemo } from "~~/server/utils/demo";

async function queueBackfill(name: TaskName) {
  try {
    await enqueueUnlessPending(name);
  } catch (error) {
    console.error(`Could not queue ${name}`, error);
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
    backfillAtaSsdAttributesOnce();
    if (!settings.config.faultsBackfilledAt && !isDemo()) {
      void queueBackfill("faults:backfill");
    }
    if (!settings.config.replicationsBackfilledAt && !isDemo()) {
      void queueBackfill("replications:backfill");
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

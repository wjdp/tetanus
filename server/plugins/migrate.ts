import type { TaskName } from "#shared/tasks";
import { databasePath, db, sqlite } from "~~/server/database/client";
import { describeMigrations, runMigrations } from "~~/server/database/migrate";
import { backfillAtaSsdAttributesIfStale } from "~~/server/services/ataSsdAttributesBackfill";
import { ensureSettings } from "~~/server/services/settings";
import {
  applySmartPolicyIfStale,
  reapplySmartPolicy,
} from "~~/server/services/smartPolicy";
import { enqueueUnlessPending } from "~~/server/tasks/queueable/alertsTick";
import { isDemo } from "~~/server/utils/demo";

// One at a time: task ids are allocated read-then-write.
async function queueBackfills(names: TaskName[]) {
  for (const name of names) {
    try {
      await enqueueUnlessPending(name);
    } catch (error) {
      console.error(`Could not queue ${name}`, error);
    }
  }
}

export default defineNitroPlugin(() => {
  try {
    if (!import.meta.dev) {
      const report = runMigrations(sqlite, db);
      console.log(describeMigrations(report, databasePath()));
    }
    const settings = ensureSettings();
    const ataSsdAttributesBackfilled = backfillAtaSsdAttributesIfStale();
    if (!applySmartPolicyIfStale() && ataSsdAttributesBackfilled) {
      reapplySmartPolicy();
    }
    if (!isDemo()) {
      const { replicationsBackfilledAt, faultsBackfilledAt } = settings.config;
      void queueBackfills([
        ...(replicationsBackfilledAt ? [] : ["replications:backfill" as const]),
        ...(faultsBackfilledAt ? [] : ["faults:backfill" as const]),
      ]);
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

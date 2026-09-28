import { databasePath, db, sqlite } from "~~/server/database/client";
import { describeMigrations, runMigrations } from "~~/server/database/migrate";

export default defineNitroPlugin(() => {
  if (import.meta.dev) return;
  try {
    const report = runMigrations(sqlite, db);
    console.log(describeMigrations(report, databasePath()));
  } catch (error) {
    console.error("Database migration failed", error);
    throw error;
  }
});

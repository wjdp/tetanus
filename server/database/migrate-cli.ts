import { databasePath, db, sqlite } from "./client";
import { describeMigrations, runMigrations } from "./migrate";

const report = runMigrations(sqlite, db);
console.log(describeMigrations(report, databasePath()));

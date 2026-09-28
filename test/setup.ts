import { db, sqlite } from "~~/server/database/client";
import { runMigrations } from "~~/server/database/migrate";

// Each test file gets its own module graph, hence its own :memory: database.
runMigrations(sqlite, db);

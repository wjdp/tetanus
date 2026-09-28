import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  DEFAULT_SETTINGS_CONFIG,
  type Settings,
  type SettingsPatch,
} from "#shared/schemas/settings";
import { db } from "~~/server/database/client";
import { setting } from "~~/server/database/schema";

const SETTING_ROW_ID = 1;

export function generateEnrolToken() {
  return randomBytes(32).toString("hex");
}

function readSettingsRow() {
  return db.select().from(setting).where(eq(setting.id, SETTING_ROW_ID)).get();
}

export function ensureSettings() {
  return (
    readSettingsRow() ??
    db
      .insert(setting)
      .values({ id: SETTING_ROW_ID, enrolToken: generateEnrolToken() })
      .returning()
      .get()
  );
}

export async function getSettings(): Promise<Settings> {
  const row = ensureSettings();
  return {
    enrolToken: row.enrolToken,
    config: { ...DEFAULT_SETTINGS_CONFIG, ...row.config },
  };
}

export async function updateSettings(patch: SettingsPatch): Promise<Settings> {
  const row = ensureSettings();
  db.update(setting)
    .set({ config: { ...row.config, ...patch.config } })
    .where(eq(setting.id, SETTING_ROW_ID))
    .run();
  return getSettings();
}

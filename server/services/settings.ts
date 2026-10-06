import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  DEFAULT_SETTINGS_CONFIG,
  type NotificationsConfig,
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

function mergeNotifications(
  sent: Partial<NotificationsConfig>,
  stored: NotificationsConfig,
): NotificationsConfig {
  return {
    pushover: sent.pushover === undefined ? stored.pushover : sent.pushover,
    webhook: sent.webhook === undefined ? stored.webhook : sent.webhook,
  };
}

export async function updateSettings(patch: SettingsPatch): Promise<Settings> {
  const row = ensureSettings();
  const current = await getSettings();
  const { notifications, ...rest } = patch.config;
  db.update(setting)
    .set({
      config: {
        ...row.config,
        ...rest,
        ...(notifications === undefined
          ? {}
          : {
              notifications: mergeNotifications(
                notifications,
                current.config.notifications,
              ),
            }),
      },
    })
    .where(eq(setting.id, SETTING_ROW_ID))
    .run();
  return getSettings();
}

export function setAlertCursor(alertCursor: number) {
  const row = ensureSettings();
  db.update(setting)
    .set({ config: { ...row.config, alertCursor } })
    .where(eq(setting.id, SETTING_ROW_ID))
    .run();
}

export function setFaultsBackfilledAt(at: Date) {
  const row = ensureSettings();
  db.update(setting)
    .set({ config: { ...row.config, faultsBackfilledAt: at.toISOString() } })
    .where(eq(setting.id, SETTING_ROW_ID))
    .run();
}

export function setReplicationsBackfilledAt(at: Date) {
  const row = ensureSettings();
  db.update(setting)
    .set({
      config: { ...row.config, replicationsBackfilledAt: at.toISOString() },
    })
    .where(eq(setting.id, SETTING_ROW_ID))
    .run();
}

export function setAtaSsdAttributesBackfilled(at: Date, version: number) {
  const row = ensureSettings();
  db.update(setting)
    .set({
      config: {
        ...row.config,
        ataSsdAttributesBackfilledAt: at.toISOString(),
        ataSsdAttributesVersion: version,
      },
    })
    .where(eq(setting.id, SETTING_ROW_ID))
    .run();
}

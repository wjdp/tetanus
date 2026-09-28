import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  DEFAULT_SETTINGS_CONFIG,
  type NotificationsConfig,
  type PushoverConfig,
  SECRET_MASK,
  type Settings,
  type SettingsPatch,
  type WebhookConfig,
} from "#shared/schemas/settings";
import { db } from "~~/server/database/client";
import { setting } from "~~/server/database/schema";
import { invalidRequest } from "~~/server/utils/serviceError";

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

function unmask(sent: string, stored: string | undefined, field: string) {
  if (sent !== SECRET_MASK) return sent;
  if (stored === undefined) {
    throw invalidRequest(`${field} has no stored value to keep`);
  }
  return stored;
}

function mergePushover(
  sent: PushoverConfig | null,
  stored: PushoverConfig | null,
): PushoverConfig | null {
  if (sent === null) return null;
  return {
    token: unmask(sent.token, stored?.token, "Pushover token"),
    user: unmask(sent.user, stored?.user, "Pushover user"),
  };
}

function mergeWebhook(
  sent: WebhookConfig | null,
  stored: WebhookConfig | null,
): WebhookConfig | null {
  if (sent === null) return null;
  const secret =
    sent.secret === undefined
      ? undefined
      : unmask(sent.secret, stored?.secret, "Webhook secret");
  return { url: sent.url, ...(secret === undefined ? {} : { secret }) };
}

function mergeNotifications(
  sent: Partial<NotificationsConfig>,
  stored: NotificationsConfig,
): NotificationsConfig {
  return {
    pushover:
      sent.pushover === undefined
        ? stored.pushover
        : mergePushover(sent.pushover, stored.pushover),
    webhook:
      sent.webhook === undefined
        ? stored.webhook
        : mergeWebhook(sent.webhook, stored.webhook),
  };
}

export function maskSettings(settings: Settings): Settings {
  const { pushover, webhook } = settings.config.notifications;
  return {
    ...settings,
    config: {
      ...settings.config,
      notifications: {
        pushover: pushover && { token: SECRET_MASK, user: SECRET_MASK },
        webhook: webhook && {
          url: webhook.url,
          ...(webhook.secret === undefined ? {} : { secret: SECRET_MASK }),
        },
      },
    },
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

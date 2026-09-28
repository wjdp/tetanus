import { z } from "zod";

export const SECRET_MASK = "•••";

const secret = z.string().trim().min(1).max(500);

export const pushoverConfigSchema = z.strictObject({
  token: secret,
  user: secret,
});

export const webhookConfigSchema = z.strictObject({
  url: z.url({ protocol: /^https?$/ }).max(2000),
  secret: z
    .string()
    .trim()
    .max(500)
    .transform((value) => value || undefined)
    .optional(),
});

export const notificationsConfigSchema = z.strictObject({
  pushover: pushoverConfigSchema.nullable(),
  webhook: webhookConfigSchema.nullable(),
});

export type PushoverConfig = z.infer<typeof pushoverConfigSchema>;
export type WebhookConfig = z.infer<typeof webhookConfigSchema>;
export type NotificationsConfig = z.infer<typeof notificationsConfigSchema>;

export const settingsConfigSchema = z.object({
  missingAfterDays: z.number().int().min(1).max(365),
  notifications: notificationsConfigSchema,
  alertCursor: z.number().int().min(0),
  smartPolicyVersion: z.number().int().min(0),
});

export type SettingsConfig = z.infer<typeof settingsConfigSchema>;

export const DEFAULT_SETTINGS_CONFIG: SettingsConfig = {
  missingAfterDays: 7,
  notifications: { pushover: null, webhook: null },
  alertCursor: 0,
  smartPolicyVersion: 0,
};

export const settingsPatchSchema = z.strictObject({
  config: z.strictObject({
    missingAfterDays: settingsConfigSchema.shape.missingAfterDays.optional(),
    notifications: notificationsConfigSchema.partial().optional(),
  }),
});

export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

export interface Settings {
  enrolToken: string;
  config: SettingsConfig;
}

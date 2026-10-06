import { z } from "zod";
import { DEFAULT_CURRENCY, isSupportedCurrency } from "../money";
import { DEFAULT_REPLICATION_THRESHOLDS } from "../replications";

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

export const currencySchema = z
  .string()
  .length(3)
  .toUpperCase()
  .refine(isSupportedCurrency, "Unknown ISO 4217 currency code");

const floorHours = z
  .number()
  .positive()
  .max(24 * 365);
const intervalFactor = z.number().positive().max(100);

export const settingsConfigSchema = z.object({
  missingAfterDays: z.number().int().min(1).max(365),
  currency: currencySchema,
  notifications: notificationsConfigSchema,
  alertCursor: z.number().int().min(0),
  smartPolicyVersion: z.number().int().min(0),
  faultsBackfilledAt: z.iso.datetime().optional(),
  ataSsdAttributesBackfilledAt: z.iso.datetime().optional(),
  ataSsdAttributesVersion: z.number().int().min(0).optional(),
  replicationsBackfilledAt: z.iso.datetime().optional(),
  replicationLateFloorHours: floorHours,
  replicationLateFactor: intervalFactor,
  replicationStalledFloorHours: floorHours,
  replicationStalledFactor: intervalFactor,
});

export type SettingsConfig = z.infer<typeof settingsConfigSchema>;

export const DEFAULT_SETTINGS_CONFIG: SettingsConfig = {
  missingAfterDays: 7,
  currency: DEFAULT_CURRENCY,
  notifications: { pushover: null, webhook: null },
  alertCursor: 0,
  smartPolicyVersion: 0,
  replicationLateFloorHours: DEFAULT_REPLICATION_THRESHOLDS.lateFloorHours,
  replicationLateFactor: DEFAULT_REPLICATION_THRESHOLDS.lateFactor,
  replicationStalledFloorHours:
    DEFAULT_REPLICATION_THRESHOLDS.stalledFloorHours,
  replicationStalledFactor: DEFAULT_REPLICATION_THRESHOLDS.stalledFactor,
};

export const settingsPatchSchema = z.strictObject({
  config: z.strictObject({
    missingAfterDays: settingsConfigSchema.shape.missingAfterDays.optional(),
    currency: currencySchema.optional(),
    notifications: notificationsConfigSchema.partial().optional(),
    replicationLateFloorHours: floorHours.optional(),
    replicationLateFactor: intervalFactor.optional(),
    replicationStalledFloorHours: floorHours.optional(),
    replicationStalledFactor: intervalFactor.optional(),
  }),
});

export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

export interface Settings {
  enrolToken: string;
  config: SettingsConfig;
}

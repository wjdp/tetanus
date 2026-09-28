import { z } from "zod";

export const settingsConfigSchema = z.object({
  missingAfterDays: z.number().int().min(1).max(365),
});

export type SettingsConfig = z.infer<typeof settingsConfigSchema>;

export const DEFAULT_SETTINGS_CONFIG: SettingsConfig = {
  missingAfterDays: 7,
};

export const settingsPatchSchema = z.strictObject({
  config: settingsConfigSchema.partial().strict(),
});

export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

export interface Settings {
  enrolToken: string;
  config: SettingsConfig;
}

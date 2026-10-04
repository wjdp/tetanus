import { z } from "zod";

export const poolParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const vdevParamsSchema = poolParamsSchema.extend({
  vdevId: z.coerce.number().int().positive(),
});

export const POOL_ARCHIVED_FILTERS = ["exclude", "include", "only"] as const;
export type PoolArchivedFilter = (typeof POOL_ARCHIVED_FILTERS)[number];

export const poolsQuerySchema = z.object({
  archived: z.enum(POOL_ARCHIVED_FILTERS).default("exclude"),
});

export const poolArchiveInputSchema = z
  .strictObject({ note: z.string().trim().max(10_000).optional() })
  .default({});

export type PoolArchiveInput = z.infer<typeof poolArchiveInputSchema>;

const nonNegativeInt = z.number().int().min(0);

const scrubIntervalDays = nonNegativeInt.max(3650);
const slowIoThreshold = nonNegativeInt;
const capacityPct = nonNegativeInt.max(100);

export const poolConfigSchema = z.strictObject({
  scrubIntervalDays: scrubIntervalDays.optional(),
  slowIoThreshold: slowIoThreshold.optional(),
  capacityWarningPct: capacityPct.optional(),
  capacityErrorPct: capacityPct.optional(),
});

export type PoolConfig = z.infer<typeof poolConfigSchema>;

/** A value sets the field; `null` removes it, back to the default. */
export const poolConfigPatchSchema = z.strictObject({
  scrubIntervalDays: scrubIntervalDays.nullable().optional(),
  slowIoThreshold: slowIoThreshold.nullable().optional(),
  capacityWarningPct: capacityPct.nullable().optional(),
  capacityErrorPct: capacityPct.nullable().optional(),
});

export type PoolConfigPatch = z.infer<typeof poolConfigPatchSchema>;
export type ResolvedPoolConfig = Required<PoolConfig>;

export const POOL_CONFIG_DEFAULTS: ResolvedPoolConfig = {
  scrubIntervalDays: 35,
  slowIoThreshold: 10,
  capacityWarningPct: 80,
  capacityErrorPct: 90,
};

/** Percentage points below a capacity threshold a pool must drop to before its fault steps down. */
export const CAPACITY_CLEAR_MARGIN = 2;

export function resolvePoolConfig(
  config: PoolConfig | null | undefined,
): ResolvedPoolConfig {
  return {
    scrubIntervalDays:
      config?.scrubIntervalDays ?? POOL_CONFIG_DEFAULTS.scrubIntervalDays,
    slowIoThreshold:
      config?.slowIoThreshold ?? POOL_CONFIG_DEFAULTS.slowIoThreshold,
    capacityWarningPct:
      config?.capacityWarningPct ?? POOL_CONFIG_DEFAULTS.capacityWarningPct,
    capacityErrorPct:
      config?.capacityErrorPct ?? POOL_CONFIG_DEFAULTS.capacityErrorPct,
  };
}

export interface PoolLastScrub {
  endAt: string;
  errors: number;
  repairedBytes: number | null;
  durationS: number;
}

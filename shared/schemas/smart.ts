import { z } from "zod";

export const SMART_HISTORY_RANGES = ["7d", "30d", "1y", "all"] as const;
export type SmartHistoryRange = (typeof SMART_HISTORY_RANGES)[number];

export const smartQuerySchema = z.object({
  range: z.enum(SMART_HISTORY_RANGES).default("30d"),
});

export type SmartQuery = z.infer<typeof smartQuerySchema>;

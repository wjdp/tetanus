import { z } from "zod";
import { ALERT_CHANNELS } from "../alerts";

export const alertsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(50),
});

export const alertTestBodySchema = z.strictObject({
  channel: z.enum(ALERT_CHANNELS),
});

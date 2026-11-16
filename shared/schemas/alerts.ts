import { z } from "zod";
import { ALERT_CHANNELS } from "../alerts";
import { pageQuerySchema } from "./page";

export const alertsQuerySchema = pageQuerySchema({});

export const alertTestBodySchema = z.strictObject({
  channel: z.enum(ALERT_CHANNELS),
});

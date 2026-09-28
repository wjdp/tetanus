import { alertsQuerySchema } from "#shared/schemas/alerts";
import { listNotifications } from "~~/server/services/alerts/dispatch";

export default defineEventHandler(async (event) => {
  const { limit } = await getValidatedQuery(event, alertsQuerySchema.parse);
  return listNotifications(limit);
});

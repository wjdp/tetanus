import { alertsQuerySchema } from "#shared/schemas/alerts";
import { listNotificationsPage } from "~~/server/services/alerts/dispatch";

export default defineEventHandler(async (event) => {
  const query = await getValidatedQuery(event, alertsQuerySchema.parse);
  return listNotificationsPage(query);
});

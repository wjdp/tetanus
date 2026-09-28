import { alertTestBodySchema } from "#shared/schemas/alerts";
import { sendTestNotification } from "~~/server/services/alerts/dispatch";

export default defineEventHandler(async (event) => {
  const { channel } = await readValidatedBody(event, alertTestBodySchema.parse);
  return await sendTestNotification(channel);
});

import { getSettings } from "~~/server/services/settings";

export default defineEventHandler(async () => {
  return await getSettings();
});

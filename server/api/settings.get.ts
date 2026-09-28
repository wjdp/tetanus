import { getSettings, maskSettings } from "~~/server/services/settings";

export default defineEventHandler(async () => {
  return maskSettings(await getSettings());
});

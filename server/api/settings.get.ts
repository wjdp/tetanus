import { getSettings } from "~~/server/services/settings";
import { presentSettings } from "~~/server/utils/demo";

export default defineEventHandler(async () => {
  return presentSettings(await getSettings());
});

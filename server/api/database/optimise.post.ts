import { optimiseDatabase } from "~~/server/services/database";
import { demoForbidden, isDemo } from "~~/server/utils/demo";

export default defineEventHandler(() => {
  if (isDemo()) demoForbidden("Database maintenance is disabled in the demo");
  return optimiseDatabase();
});

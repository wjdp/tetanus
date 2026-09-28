import { sqlite } from "~~/server/database/client";

async function checkDatabase() {
  try {
    sqlite.prepare("SELECT 1;").get();
    return true;
  } catch {
    return false;
  }
}

export default defineEventHandler(async (event) => {
  const database = await checkDatabase();
  const ok = database;
  if (!ok) {
    setResponseStatus(event, 500);
  }
  return {
    ok,
    checks: {
      database,
    },
  };
});

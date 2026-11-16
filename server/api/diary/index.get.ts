import { diaryQuerySchema } from "#shared/schemas/diary";
import { listDiaryPage } from "~~/server/services/diary";

export default defineEventHandler(async (event) => {
  const query = await getValidatedQuery(event, diaryQuerySchema.parse);
  return listDiaryPage(query);
});

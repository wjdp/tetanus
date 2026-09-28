import { diaryQuerySchema } from "#shared/schemas/diary";
import { listDiary } from "~~/server/services/diary";

export default defineEventHandler(async (event) => {
  const query = await getValidatedQuery(event, diaryQuerySchema.parse);
  return listDiary(query);
});

import { diaryParamsSchema } from "#shared/schemas/diary";
import { deleteManualEntry } from "~~/server/services/diary";
import { respondWithServiceErrors } from "~~/server/utils/respondWithServiceErrors";

export default defineEventHandler(async (event) => {
  const { id } = await getValidatedRouterParams(event, diaryParamsSchema.parse);
  await respondWithServiceErrors(async () => deleteManualEntry(id));
  setResponseStatus(event, 204);
  return null;
});

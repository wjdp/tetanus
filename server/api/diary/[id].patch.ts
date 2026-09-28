import {
  diaryEntryPatchSchema,
  diaryParamsSchema,
} from "#shared/schemas/diary";
import { updateManualEntry } from "~~/server/services/diary";
import { respondWithServiceErrors } from "~~/server/utils/respondWithServiceErrors";

export default defineEventHandler(async (event) => {
  const { id } = await getValidatedRouterParams(event, diaryParamsSchema.parse);
  const patch = await readValidatedBody(event, diaryEntryPatchSchema.parse);
  return await respondWithServiceErrors(async () =>
    updateManualEntry(id, patch),
  );
});

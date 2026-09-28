import { diaryEntryInputSchema } from "#shared/schemas/diary";
import { addManualEntry } from "~~/server/services/diary";

export default defineEventHandler(async (event) => {
  const entry = await readValidatedBody(event, diaryEntryInputSchema.parse);
  setResponseStatus(event, 201);
  return addManualEntry(entry);
});

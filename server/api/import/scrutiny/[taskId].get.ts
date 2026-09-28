import { scrutinyImportResultParamsSchema } from "#shared/schemas/import";
import type { ScrutinyImportResult } from "~~/server/services/importers/scrutiny";
import { getTaskResult } from "~~/server/tasks/queue";

export default defineEventHandler(async (event) => {
  const { taskId } = await getValidatedRouterParams(
    event,
    scrutinyImportResultParamsSchema.parse,
  );
  const result = await getTaskResult<ScrutinyImportResult>(taskId);
  if (!result) {
    throw createError({
      statusCode: 404,
      statusMessage: `No scrutiny import result for task ${taskId}`,
    });
  }
  return result;
});

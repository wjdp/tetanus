import { scrutinyImportSchema } from "#shared/schemas/import";
import { getHost } from "~~/server/services/hosts";
import { importScrutiny } from "~~/server/services/importers/scrutiny";
import { createTask } from "~~/server/tasks/queue";
import { demoForbidden, isDemo } from "~~/server/utils/demo";
import { respondWithServiceErrors } from "~~/server/utils/respondWithServiceErrors";

export default defineEventHandler(async (event) => {
  if (isDemo()) demoForbidden("Import is disabled in the demo");
  const { url, hostId, dryRun } = await readValidatedBody(
    event,
    scrutinyImportSchema.parse,
  );
  return await respondWithServiceErrors(async () => {
    if (dryRun) return await importScrutiny({ url, hostId, dryRun });
    getHost(hostId);
    const task = await createTask("import:scrutiny", { url, hostId });
    return { taskId: task.id };
  });
});

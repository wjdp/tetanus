import { scrutinyImportTaskPayloadSchema } from "#shared/schemas/import";
import { importScrutiny } from "~~/server/services/importers/scrutiny";
import {
  setTaskResult,
  type Task,
  updateInProgressTask,
} from "~~/server/tasks/queue";

export default async (task: Task) => {
  const { url, hostId } = scrutinyImportTaskPayloadSchema.parse(task.payload);
  const result = await importScrutiny({
    url,
    hostId,
    dryRun: false,
    onProgress: (done, total) =>
      updateInProgressTask(task, {
        done,
        total,
        progress: total === 0 ? 1 : done / total,
        message: `${done} / ${total} devices`,
      }),
  });
  await setTaskResult(task.id, result);
};

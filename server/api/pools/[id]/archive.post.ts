import {
  poolArchiveInputSchema,
  poolParamsSchema,
} from "#shared/schemas/pools";
import { archivePool } from "~~/server/services/zfs";
import { requestAlertsTick } from "~~/server/tasks/queueable/alertsTick";
import { respondWithServiceErrors } from "~~/server/utils/respondWithServiceErrors";

export default defineEventHandler(async (event) => {
  const { id } = await getValidatedRouterParams(event, poolParamsSchema.parse);
  const { note } = await readValidatedBody(event, poolArchiveInputSchema.parse);
  const archived = await respondWithServiceErrors(async () =>
    archivePool(id, note),
  );
  void requestAlertsTick();
  return archived;
});

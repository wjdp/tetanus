import { poolParamsSchema } from "#shared/schemas/pools";
import { unarchivePool } from "~~/server/services/zfs";
import { requestAlertsTick } from "~~/server/tasks/queueable/alertsTick";
import { respondWithServiceErrors } from "~~/server/utils/respondWithServiceErrors";

export default defineEventHandler(async (event) => {
  const { id } = await getValidatedRouterParams(event, poolParamsSchema.parse);
  const unarchived = await respondWithServiceErrors(async () =>
    unarchivePool(id),
  );
  void requestAlertsTick();
  return unarchived;
});

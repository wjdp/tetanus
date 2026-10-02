import { poolConfigPatchSchema, poolParamsSchema } from "#shared/schemas/pools";
import { updatePoolConfig } from "~~/server/services/zfs";
import { requestAlertsTick } from "~~/server/tasks/queueable/alertsTick";
import { respondWithServiceErrors } from "~~/server/utils/respondWithServiceErrors";

export default defineEventHandler(async (event) => {
  const { id } = await getValidatedRouterParams(event, poolParamsSchema.parse);
  const patch = await readValidatedBody(event, poolConfigPatchSchema.parse);
  const updated = await respondWithServiceErrors(async () =>
    updatePoolConfig(id, patch),
  );
  void requestAlertsTick();
  return updated;
});

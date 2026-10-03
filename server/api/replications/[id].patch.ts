import {
  replicationParamsSchema,
  replicationPatchSchema,
} from "#shared/schemas/replications";
import { updateReplication } from "~~/server/services/replications";
import { requestAlertsTick } from "~~/server/tasks/queueable/alertsTick";
import { respondWithServiceErrors } from "~~/server/utils/respondWithServiceErrors";

export default defineEventHandler(async (event) => {
  const { id } = await getValidatedRouterParams(
    event,
    replicationParamsSchema.parse,
  );
  const patch = await readValidatedBody(event, replicationPatchSchema.parse);
  const updated = await respondWithServiceErrors(async () =>
    updateReplication(id, patch),
  );
  void requestAlertsTick();
  return updated;
});

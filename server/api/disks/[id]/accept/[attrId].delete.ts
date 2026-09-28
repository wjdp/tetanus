import { acceptanceParamsSchema } from "#shared/schemas/acceptance";
import { clearAcceptance } from "~~/server/services/acceptance";
import { respondWithServiceErrors } from "~~/server/utils/respondWithServiceErrors";

export default defineEventHandler(async (event) => {
  const { id, attrId } = await getValidatedRouterParams(
    event,
    acceptanceParamsSchema.parse,
  );
  return await respondWithServiceErrors(async () =>
    clearAcceptance(id, attrId),
  );
});

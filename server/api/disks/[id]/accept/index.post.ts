import { faultAcceptanceInputSchema } from "#shared/schemas/acceptance";
import { diskParamsSchema } from "#shared/schemas/disks";
import { acceptFault } from "~~/server/services/acceptance";
import { respondWithServiceErrors } from "~~/server/utils/respondWithServiceErrors";

export default defineEventHandler(async (event) => {
  const { id } = await getValidatedRouterParams(event, diskParamsSchema.parse);
  const input = await readValidatedBody(
    event,
    faultAcceptanceInputSchema.parse,
  );
  const acceptance = await respondWithServiceErrors(async () =>
    acceptFault({ diskId: id, ...input }),
  );
  setResponseStatus(event, 201);
  return acceptance;
});

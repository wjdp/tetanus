import { bayPatchSchema } from "#shared/schemas/bays";
import { hostParamsSchema } from "#shared/schemas/hosts";
import { patchBays } from "~~/server/services/bays";
import { listHostBays } from "~~/server/services/locations";
import { respondWithServiceErrors } from "~~/server/utils/respondWithServiceErrors";

export default defineEventHandler(async (event) => {
  const { id } = await getValidatedRouterParams(event, hostParamsSchema.parse);
  const patch = await readValidatedBody(event, bayPatchSchema.parse);
  return await respondWithServiceErrors(async () => {
    patchBays(id, patch);
    return listHostBays(id);
  });
});

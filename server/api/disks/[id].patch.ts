import { diskParamsSchema, diskPatchSchema } from "#shared/schemas/disks";
import { updateDisk } from "~~/server/services/disks";
import { respondWithServiceErrors } from "~~/server/utils/respondWithServiceErrors";

export default defineEventHandler(async (event) => {
  const { id } = await getValidatedRouterParams(event, diskParamsSchema.parse);
  const patch = await readValidatedBody(event, diskPatchSchema.parse);
  return await respondWithServiceErrors(() => updateDisk(id, patch));
});

import { hostOrderSchema } from "#shared/schemas/hosts";
import { reorderHosts } from "~~/server/services/hosts";
import { respondWithServiceErrors } from "~~/server/utils/respondWithServiceErrors";

export default defineEventHandler(async (event) => {
  const { hostIds } = await readValidatedBody(event, hostOrderSchema.parse);
  return await respondWithServiceErrors(async () => reorderHosts(hostIds));
});

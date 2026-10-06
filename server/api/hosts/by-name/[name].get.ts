import { hostNameParamsSchema } from "#shared/schemas/hosts";
import { getHostByName } from "~~/server/services/hosts";
import { respondWithServiceErrors } from "~~/server/utils/respondWithServiceErrors";

export default defineEventHandler(async (event) => {
  const { name } = await getValidatedRouterParams(
    event,
    hostNameParamsSchema.parse,
    { decode: true },
  );
  return await respondWithServiceErrors(async () => getHostByName(name));
});

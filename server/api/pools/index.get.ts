import { poolsQuerySchema } from "#shared/schemas/pools";
import { listPools } from "~~/server/services/zfs";

export default defineEventHandler(async (event) => {
  const { archived } = await getValidatedQuery(event, poolsQuerySchema.parse);
  return listPools(archived);
});

import { zfsPathParamsSchema } from "#shared/schemas/pools";
import { replicationsOfDataset } from "~~/server/services/replications";
import { getDataset, getPool } from "~~/server/services/zfs";
import { resolveZfsPath } from "~~/server/services/zfs/paths";
import { respondWithServiceErrors } from "~~/server/utils/respondWithServiceErrors";

export default defineEventHandler(async (event) => {
  const { host, path } = await getValidatedRouterParams(
    event,
    zfsPathParamsSchema.parse,
    { decode: true },
  );
  return await respondWithServiceErrors(async () => {
    const target = resolveZfsPath(host, path.split("/"));
    if (target.kind === "pool") {
      return { kind: target.kind, pool: getPool(target.id) };
    }
    return {
      kind: target.kind,
      dataset: {
        ...getDataset(target.id),
        replications: replicationsOfDataset(target.id),
      },
    };
  });
});

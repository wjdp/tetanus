import { strToU8, zipSync } from "fflate";
import { diskParamsSchema } from "#shared/schemas/disks";
import {
  buildDiskDiagnostics,
  diagnosticsName,
} from "~~/server/services/diagnostics";
import { respondWithServiceErrors } from "~~/server/utils/respondWithServiceErrors";

export default defineEventHandler(async (event) => {
  const { id } = await getValidatedRouterParams(event, diskParamsSchema.parse);
  const now = new Date();
  const bundle = await respondWithServiceErrors(() =>
    buildDiskDiagnostics(id, {
      now,
      appVersion: useRuntimeConfig(event).public.version,
    }),
  );
  const name = diagnosticsName(id, now);
  const zip = zipSync(
    Object.fromEntries(
      Object.entries(bundle).map(([path, body]) => [
        `${name}/${path}`,
        strToU8(body),
      ]),
    ),
  );
  setResponseHeaders(event, {
    "content-type": "application/zip",
    "content-disposition": `attachment; filename="${name}.zip"`,
  });
  return zip;
});

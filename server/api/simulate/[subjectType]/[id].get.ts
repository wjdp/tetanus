import { simulationSubjectParamsSchema } from "#shared/schemas/simulate";
import { subjectScenarios } from "~~/server/services/simulator/run";
import { respondWithServiceErrors } from "~~/server/utils/respondWithServiceErrors";

export default defineEventHandler(async (event) => {
  requireSimulator();
  const { subjectType, id } = await getValidatedRouterParams(
    event,
    simulationSubjectParamsSchema.parse,
  );
  return await respondWithServiceErrors(async () =>
    subjectScenarios(subjectType, id),
  );
});

import {
  simulateInputSchema,
  simulationSubjectParamsSchema,
} from "#shared/schemas/simulate";
import { simulate } from "~~/server/services/simulator/run";
import { respondWithServiceErrors } from "~~/server/utils/respondWithServiceErrors";

export default defineEventHandler(async (event) => {
  requireSimulator();
  const { subjectType, id } = await getValidatedRouterParams(
    event,
    simulationSubjectParamsSchema.parse,
  );
  const { scenario, params } = await readValidatedBody(
    event,
    simulateInputSchema.parse,
  );
  return await respondWithServiceErrors(async () =>
    simulate(subjectType, id, scenario, params),
  );
});

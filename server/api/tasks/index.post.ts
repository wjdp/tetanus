import { runTaskBodySchema } from "#shared/schemas/tasks";
import { createTask } from "~~/server/tasks/queue";
import { demoForbidden, isDemo } from "~~/server/utils/demo";

export default defineEventHandler(async (event) => {
  if (isDemo()) demoForbidden("Tasks are disabled in the demo");
  const { taskName, payload } = await readValidatedBody(
    event,
    runTaskBodySchema.parse,
  );
  return await createTask(taskName, payload);
});

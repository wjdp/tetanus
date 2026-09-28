import { runTaskBodySchema } from "#shared/schemas/tasks";
import { createTask } from "~~/server/tasks/queue";

export default defineEventHandler(async (event) => {
  const { taskName, payload } = await readValidatedBody(
    event,
    runTaskBodySchema.parse,
  );
  return await createTask(taskName, payload);
});

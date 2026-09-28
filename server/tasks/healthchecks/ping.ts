import { enqueueUnlessPending } from "~~/server/tasks/queueable/alertsTick";

export default defineTask({
  meta: {
    name: "healthchecks:ping",
    description: "Queue a healthchecks ping for every host",
  },
  async run() {
    const task = await enqueueUnlessPending("healthchecks:ping");
    return { result: task ? `Queued task ${task.id}` : "Already queued" };
  },
});

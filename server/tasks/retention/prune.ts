import { enqueueUnlessPending } from "~~/server/tasks/queueable/alertsTick";

export default defineTask({
  meta: {
    name: "retention:prune",
    description: "Queue a retention pass that prunes and downsamples history",
  },
  async run() {
    const task = await enqueueUnlessPending("retention:prune");
    return { result: task ? `Queued task ${task.id}` : "Already queued" };
  },
});

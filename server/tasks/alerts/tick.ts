import { enqueueUnlessPending } from "~~/server/tasks/queueable/alertsTick";

export default defineTask({
  meta: {
    name: "alerts:tick",
    description: "Queue an alerts pass over new diary entries",
  },
  async run() {
    const task = await enqueueUnlessPending("alerts:tick");
    return { result: task ? `Queued task ${task.id}` : "Already queued" };
  },
});

import type { TaskName } from "#shared/tasks";
import { runAlertsPass } from "~~/server/services/alerts/dispatch";
import { createTask, getAllTasks } from "~~/server/tasks/queue";

export async function enqueueUnlessPending(name: TaskName) {
  const tasks = await getAllTasks();
  if (tasks.some((task) => task.name === name && task.state === "pending")) {
    return null;
  }
  return createTask(name);
}

export async function requestAlertsTick() {
  try {
    await enqueueUnlessPending("alerts:tick");
  } catch (error) {
    console.error("Could not queue alerts:tick", error);
  }
}

export default async () => {
  const summary = await runAlertsPass();
  if (summary.alerts > 0 || summary.retried > 0) {
    console.log(
      `Alerts pass: ${summary.alerts} alerts, ${summary.sent} sent, ${summary.failed} failed, ${summary.retried} retried`,
    );
  }
};

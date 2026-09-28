import { useSseEvent } from "~~/server/sse";
import { TaskMap } from "~~/server/tasks/router";
import { completeTask, getCurrentTask, updateTaskStatus } from "./queue";

const queueNextTask = () => {
  // Loop this task to pick up the next task
  // The setTimeout is needed as Nitro will prevent the task from running
  // while this instance is still running.
  setTimeout(() => runTask("handler"), 100);
};

export default defineTask({
  meta: {
    name: "handler",
    description: "Handle tasks on the task queue",
  },
  async run() {
    const { push } = useSseEvent();
    const currentTask = await getCurrentTask();
    if (!currentTask) {
      push("message", { message: "All tasks completed" });
      return { result: "No tasks to run" };
    }
    const taskNameLog = `${currentTask.id}:${currentTask.name}`;
    if (currentTask.state !== "pending") {
      console.log("task already running");
      return { result: "Task already running" };
    }
    const taskFunction = TaskMap[currentTask.name];
    if (!taskFunction) {
      console.error(`Task function not found for task ${taskNameLog}`);
      await updateTaskStatus(currentTask.id, "failed");
      push("task", {
        id: currentTask.id,
        name: currentTask.name,
        payload: currentTask.payload,
        state: "failed",
      });
      return { result: "Task function not found" };
    }
    await updateTaskStatus(currentTask.id, "in_progress");
    push("task", {
      id: currentTask.id,
      name: currentTask.name,
      payload: currentTask.payload,
      state: "in_progress",
    });
    console.log(`Running task ${taskNameLog}`);
    try {
      await taskFunction(currentTask);
    } catch (error) {
      console.error(`Task ${taskNameLog} failed: ${error}`);
      await completeTask(currentTask.id, "failed");
      push("task", {
        id: currentTask.id,
        name: currentTask.name,
        payload: currentTask.payload,
        state: "failed",
        message: `${error}`,
      });
      queueNextTask();
      return { result: "Task failed" };
    }

    await completeTask(currentTask.id, "done");
    push("task", {
      id: currentTask.id,
      name: currentTask.name,
      payload: currentTask.payload,
      state: "done",
    });

    console.log("Task completed, triggered new task handler");
    queueNextTask();
    return { result: "Success" };
  },
});

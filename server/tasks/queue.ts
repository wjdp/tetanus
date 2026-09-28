import type { TaskName, TaskPayload, TaskState } from "#shared/tasks";
import { useSseEvent } from "~~/server/sse";

const CURRENT_TASK_ID = "currentTaskId";
const LAST_TASK_KEY = "lastTaskId";

export interface Task {
  id: number;
  name: TaskName;
  state: TaskState;
  payload?: TaskPayload;
}

function getTaskKey(taskId: number) {
  return `task:${taskId}`;
}

function parseIdFromStore(v: unknown): number | null {
  if (typeof v === "number") {
    return v;
  }
  if (typeof v === "string") {
    const id = parseInt(v, 10);
    if (!Number.isNaN(id)) {
      return id;
    }
  }
  return null;
}

async function getTask(id: number): Promise<Task> {
  const storage = await useStorage();
  return (await storage.get(getTaskKey(id))) as Task;
}

export async function getCurrentTask(): Promise<Task | null> {
  const storage = await useStorage();
  const currentTaskId = parseIdFromStore(await storage.get(CURRENT_TASK_ID));
  if (!currentTaskId) {
    return null;
  }
  return await getTask(currentTaskId);
}

async function getNewTaskId() {
  const storage = await useStorage();
  const lastTaskId = parseIdFromStore(await storage.get(LAST_TASK_KEY));
  const newTaskId = lastTaskId ? lastTaskId + 1 : 1;
  await storage.set(LAST_TASK_KEY, newTaskId);
  return newTaskId;
}

export async function updateTaskStatus(taskId: number, status: Task["state"]) {
  const storage = await useStorage();
  const task = await getTask(taskId);
  if (!task) {
    throw new Error(`Task ${taskId} not found`);
  }
  task.state = status;
  await storage.set(getTaskKey(taskId), task);
  console.log(`Task ${taskId} ${status}`);
}

export async function completeTask(taskId: number, status: "done" | "failed") {
  await updateTaskStatus(taskId, status);
  const storage = await useStorage();
  // check if there's a new task
  const nextTask = await getTask(taskId + 1);
  if (nextTask) {
    await storage.set(CURRENT_TASK_ID, nextTask.id);
  } else {
    await storage.remove(CURRENT_TASK_ID);
  }
  return nextTask;
}

export async function createTask(
  taskName: TaskName,
  payload?: TaskPayload,
): Promise<Task> {
  const taskId = await getNewTaskId();
  const task: Task = {
    id: taskId,
    name: taskName,
    state: "pending",
    ...(payload ? { payload } : {}),
  };
  const storage = await useStorage();
  const { push } = useSseEvent();
  await storage.set(getTaskKey(taskId), task);
  const currentTaskId = await storage.get(CURRENT_TASK_ID);
  if (!currentTaskId) {
    await storage.set(CURRENT_TASK_ID, taskId);
  }
  push("task", task);
  console.log(`Task ${taskId}:${taskName} created`);
  runTask("handler");
  return task;
}

export async function getAllTasks(): Promise<Task[]> {
  const storage = await useStorage();
  const taskKeys = await storage.getKeys("task:");
  const rawTasks = await storage.getItems(taskKeys);
  return rawTasks.map((rawTask) => rawTask.value as Task);
}

export function updateInProgressTask(
  task: Task,
  {
    progress,
    message,
    done,
    total,
  }: { progress?: number; message?: string; done?: number; total?: number },
) {
  const { push } = useSseEvent();
  push("task", {
    ...task,
    state: "in_progress",
    progress,
    message,
    done,
    total,
  });
}

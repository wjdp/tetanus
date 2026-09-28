import type { TaskName, TaskPayload, TaskState } from "#shared/tasks";
import { useSseEvent } from "~~/server/sse";

const CURRENT_TASK_ID = "currentTaskId";
const LAST_TASK_KEY = "lastTaskId";
export const FINISHED_TASKS_KEPT = 200;

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

// Results live beside the task rather than on it: /api/tasks stays a light
// list and each importer exposes its own typed result route.
function getTaskResultKey(taskId: number) {
  return `taskResult:${taskId}`;
}

export async function setTaskResult(taskId: number, result: object) {
  const storage = await useStorage();
  if (!(await getTask(taskId))) {
    throw new Error(`Task ${taskId} not found`);
  }
  await storage.set(getTaskResultKey(taskId), result);
}

export async function getTaskResult<T>(taskId: number): Promise<T | null> {
  const storage = await useStorage();
  return ((await storage.get(getTaskResultKey(taskId))) as T | null) ?? null;
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
  await pruneFinishedTasks();
  return nextTask;
}

const isFinished = (task: Task) =>
  task.state === "done" || task.state === "failed";

export async function pruneFinishedTasks(keep = FINISHED_TASKS_KEPT) {
  const storage = await useStorage();
  const expired = (await getAllTasks())
    .filter(isFinished)
    .sort((a, b) => b.id - a.id)
    .slice(keep);
  for (const task of expired) {
    await storage.remove(getTaskKey(task.id));
    await storage.remove(getTaskResultKey(task.id));
  }
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

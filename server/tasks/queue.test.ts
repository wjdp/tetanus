import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SseMessageMap, SseMessageType } from "#shared/sse";
import { sseHooks } from "~~/server/sse";
import {
  completeTask,
  createTask,
  FINISHED_TASKS_KEPT,
  getAllTasks,
  getCurrentTask,
  updateTaskStatus,
} from "~~/server/tasks/queue";

function memoryStorage() {
  const items = new Map<string, unknown>();
  return {
    get: async (key: string) => items.get(key) ?? null,
    set: async (key: string, value: unknown) => {
      items.set(key, value);
    },
    remove: async (key: string) => {
      items.delete(key);
    },
    getKeys: async (base: string) =>
      [...items.keys()].filter((key) => key.startsWith(base)),
    getItems: async (keys: string[]) =>
      keys.map((key) => ({ key, value: items.get(key) })),
  };
}

const runTask = vi.fn();
const pushed: { type: SseMessageType; data: unknown }[] = [];

beforeEach(() => {
  const storage = memoryStorage();
  vi.stubGlobal("useStorage", () => storage);
  vi.stubGlobal("runTask", runTask);
  runTask.mockClear();
  pushed.length = 0;
  sseHooks.removeAllHooks();
  sseHooks.hook(
    "default",
    <T extends SseMessageType>(type: T, data: SseMessageMap[T]) => {
      pushed.push({ type, data });
    },
  );
});

describe("task queue", () => {
  it("creates a pending task, makes it current and kicks the handler", async () => {
    const task = await createTask("noop");

    expect(task).toEqual({ id: 1, name: "noop", state: "pending" });
    expect(await getCurrentTask()).toEqual(task);
    expect(runTask).toHaveBeenCalledWith("handler");
    expect(pushed).toEqual([{ type: "task", data: task }]);
  });

  it("numbers tasks sequentially and keeps the first one current", async () => {
    await createTask("noop");
    await createTask("noop", { source: "smartctl-scan" });

    expect((await getCurrentTask())?.id).toBe(1);
    expect(await getAllTasks()).toEqual([
      { id: 1, name: "noop", state: "pending" },
      {
        id: 2,
        name: "noop",
        state: "pending",
        payload: { source: "smartctl-scan" },
      },
    ]);
  });

  it("advances to the next task on completion", async () => {
    await createTask("noop");
    await createTask("noop");

    const next = await completeTask(1, "done");

    expect(next?.id).toBe(2);
    expect((await getCurrentTask())?.id).toBe(2);
    expect((await getAllTasks()).find((task) => task.id === 1)?.state).toBe(
      "done",
    );
  });

  it("clears the current task when the queue drains", async () => {
    await createTask("noop");

    await completeTask(1, "failed");

    expect(await getCurrentTask()).toBeNull();
  });

  it("refuses to update a task that does not exist", async () => {
    await expect(updateTaskStatus(99, "done")).rejects.toThrow(/not found/);
  });

  it("keeps only the newest finished tasks and every unfinished one", async () => {
    const finishedCount = FINISHED_TASKS_KEPT + 5;
    for (let id = 1; id <= finishedCount + 2; id++) await createTask("noop");
    for (let id = 1; id < finishedCount; id++) {
      await updateTaskStatus(id, id % 2 ? "done" : "failed");
    }
    await updateTaskStatus(finishedCount + 1, "in_progress");

    await completeTask(finishedCount, "done");

    const tasks = await getAllTasks();
    const finishedIds = tasks
      .filter((task) => task.state === "done" || task.state === "failed")
      .map((task) => task.id)
      .sort((a, b) => a - b);
    expect(finishedIds).toHaveLength(FINISHED_TASKS_KEPT);
    expect(finishedIds[0]).toBe(6);
    expect(finishedIds.at(-1)).toBe(finishedCount);
    expect(
      tasks
        .filter((task) => task.id > finishedCount)
        .map(({ id, state }) => [id, state]),
    ).toEqual([
      [finishedCount + 1, "in_progress"],
      [finishedCount + 2, "pending"],
    ]);
  });
});

import type { TaskName } from "#shared/tasks";
import type { Task } from "~~/server/tasks/queue";
import noop from "./queueable/noop";

export const TaskMap: { [k in TaskName]: (task: Task) => Promise<void> } = {
  noop,
};

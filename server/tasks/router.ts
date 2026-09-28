import type { TaskName } from "#shared/tasks";
import type { Task } from "~~/server/tasks/queue";
import alertsTick from "./queueable/alertsTick";
import healthchecksPing from "./queueable/healthchecksPing";
import noop from "./queueable/noop";
import scrutinyImport from "./queueable/scrutinyImport";

export const TaskMap: { [k in TaskName]: (task: Task) => Promise<void> } = {
  noop,
  "alerts:tick": alertsTick,
  "healthchecks:ping": healthchecksPing,
  "import:scrutiny": scrutinyImport,
};

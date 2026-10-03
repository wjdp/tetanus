import type { TaskName } from "#shared/tasks";
import type { Task } from "~~/server/tasks/queue";
import alertsTick from "./queueable/alertsTick";
import faultsBackfill from "./queueable/faultsBackfill";
import healthchecksPing from "./queueable/healthchecksPing";
import noop from "./queueable/noop";
import replicationsBackfill from "./queueable/replicationsBackfill";
import scrutinyImport from "./queueable/scrutinyImport";

export const TaskMap: { [k in TaskName]: (task: Task) => Promise<void> } = {
  noop,
  "alerts:tick": alertsTick,
  "healthchecks:ping": healthchecksPing,
  "import:scrutiny": scrutinyImport,
  "faults:backfill": faultsBackfill,
  "replications:backfill": replicationsBackfill,
};

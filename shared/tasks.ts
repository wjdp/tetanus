export const TASK_NAMES = [
  "noop",
  "alerts:tick",
  "healthchecks:ping",
  "import:scrutiny",
] as const;

export type TaskName = (typeof TASK_NAMES)[number];

export type TaskState = "pending" | "in_progress" | "done" | "failed";

export type TaskPayload = Record<string, string | number | boolean>;

import type { TaskName, TaskPayload, TaskState } from "#shared/tasks";

export interface SseMessage {
  message: string;
}

export interface SseNotification {
  title: string;
  message: string;
}

export interface SseTask {
  id: number;
  name: TaskName;
  state: TaskState;
  payload?: TaskPayload;
  progress?: number;
  message?: string;
  done?: number;
  total?: number;
}

// Map of event names to their types
export interface SseMessageMap {
  message: SseMessage;
  notification: SseNotification;
  task: SseTask;
}

export type SseMessageType = keyof SseMessageMap;

import { vi } from "vitest";
import type { SseTask } from "#shared/sse";

type FakeHandler = (event: { data: string }) => void;

export class FakeEventSource {
  static instances: FakeEventSource[] = [];

  handlers = new Map<string, FakeHandler[]>();
  closed = false;

  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }

  static install() {
    vi.stubGlobal("EventSource", FakeEventSource);
  }

  addEventListener(name: string, handler: FakeHandler) {
    const existing = this.handlers.get(name);
    if (existing) {
      existing.push(handler);
    } else {
      this.handlers.set(name, [handler]);
    }
  }

  close() {
    this.closed = true;
  }
}

// The SSE client keeps one connection for the whole module graph, so emitting
// on every instance reaches whichever one the client is holding.
export const emitSseEvent = (name: string, data: unknown) => {
  for (const instance of FakeEventSource.instances) {
    for (const handler of instance.handlers.get(name) ?? []) {
      handler({ data: JSON.stringify(data) });
    }
  }
};

export const emitTask = (task: SseTask) => emitSseEvent("task", task);

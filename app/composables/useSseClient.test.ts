// @vitest-environment nuxt
import { describe, expect, it, vi } from "vitest";
import { effectScope } from "vue";
import { useSseClient } from "./useSseClient";

type FakeHandler = (event: { data: string }) => void;

class FakeEventSource {
  static instances: FakeEventSource[] = [];

  handlers = new Map<string, FakeHandler[]>();
  closed = false;

  constructor(public url: string) {
    FakeEventSource.instances.push(this);
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

  emit(name: string, data: unknown) {
    for (const handler of this.handlers.get(name) ?? []) {
      handler({ data: JSON.stringify(data) });
    }
  }
}

vi.stubGlobal("EventSource", FakeEventSource);

const latestSource = () =>
  FakeEventSource.instances[FakeEventSource.instances.length - 1]!;

describe("useSseClient", () => {
  it("shares a single connection across callers", () => {
    useSseClient();
    useSseClient();

    expect(FakeEventSource.instances).toHaveLength(1);
    expect(latestSource().url).toBe("/api/sse");
  });

  it("delivers an event to every listener of that event name", () => {
    const first = vi.fn();
    const second = vi.fn();

    useSseClient().onMessage("task", first);
    useSseClient().onMessage("task", second);
    latestSource().emit("task", { id: 1, name: "noop", state: "pending" });

    expect(first).toHaveBeenCalledWith({
      id: 1,
      name: "noop",
      state: "pending",
    });
    expect(second).toHaveBeenCalledWith({
      id: 1,
      name: "noop",
      state: "pending",
    });
  });

  it("stops delivering once the subscribing scope is disposed", () => {
    const scoped = vi.fn();
    const scope = effectScope();
    scope.run(() => useSseClient().onMessage("message", scoped));

    latestSource().emit("message", { message: "one" });
    scope.stop();
    latestSource().emit("message", { message: "two" });

    expect(scoped).toHaveBeenCalledTimes(1);
  });
});

import type { SseMessageMap, SseMessageType } from "#shared/sse";

type SseListener = (data: never) => void;

// Module level: every caller shares one connection and one listener registry,
// so a second component subscribing cannot drop the first one's listeners.
let eventSource: EventSource | undefined;
const listeners = new Map<SseMessageType, Set<SseListener>>();
const open = ref(false);

const attachEventName = (source: EventSource, name: SseMessageType) => {
  source.addEventListener(name, (event) => {
    const message = JSON.parse(event.data);
    for (const listener of listeners.get(name) ?? []) {
      (listener as (data: unknown) => void)(message);
    }
  });
};

const connect = () => {
  const source = new EventSource("/api/sse");
  eventSource = source;
  for (const name of listeners.keys()) {
    attachEventName(source, name);
  }
  source.onopen = () => {
    open.value = true;
  };
  source.onerror = (event) => {
    console.error("EventSource error:", event);
    open.value = false;
    source.close();
    if (eventSource === source) {
      setTimeout(connect, 1000);
    }
  };
};

export const useSseClient = () => {
  if (import.meta.server) {
    return {
      onMessage: <T extends SseMessageType>(
        _name: T,
        _callback: (data: SseMessageMap[T]) => void,
      ) => {},
      open: ref(false),
      close: () => {},
    };
  }

  if (!eventSource) {
    connect();
  }

  const onMessage = <T extends SseMessageType>(
    name: T,
    callback: (data: SseMessageMap[T]) => void,
  ) => {
    const existing = listeners.get(name);
    if (existing) {
      existing.add(callback as SseListener);
    } else {
      listeners.set(name, new Set([callback as SseListener]));
      if (eventSource) {
        attachEventName(eventSource, name);
      }
    }
    const unsubscribe = () => {
      listeners.get(name)?.delete(callback as SseListener);
    };
    onScopeDispose(unsubscribe, true);
    return unsubscribe;
  };

  return {
    onMessage,
    open,
    close: () => {
      eventSource?.close();
      eventSource = undefined;
      open.value = false;
    },
  };
};

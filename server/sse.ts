import { createEventStream, type H3Event } from "h3";
import { createHooks } from "hookable";
import type { SseMessageMap, SseMessageType } from "#shared/sse";

const defaultBusName = "default";

export interface ServerSentEvent {
  [key: string]: <T extends SseMessageType>(
    type: T,
    data: SseMessageMap[T],
  ) => void;
}

export const sseHooks = createHooks<ServerSentEvent>();

export const useSse = (event: H3Event, busName: string = defaultBusName) => {
  const eventStream = createEventStream(event);
  let counter = 0;

  // Used by Nginx to disable response buffering
  appendResponseHeader(event, "X-Accel-Buffering", "no");

  const unhook = sseHooks.hook(
    busName,
    <T extends SseMessageType>(type: T, data: SseMessageMap[T]) => {
      eventStream.push({
        id: (counter++).toString(),
        event: type,
        retry: 2,
        data: JSON.stringify(data),
      });
    },
  );
  eventStream.onClosed(unhook);

  const { push } = useSseEvent(busName);

  return {
    eventStream,
    push,
    close: (callback: () => void) => eventStream.onClosed(callback),
  };
};

export const useSseEvent = (busName: string = defaultBusName) => {
  return {
    push: <T extends SseMessageType>(name: T, data: SseMessageMap[T]) => {
      sseHooks.callHook(busName, name, data);
    },
  };
};

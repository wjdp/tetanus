import { useSse } from "~~/server/sse";

export default defineEventHandler(async (event) => {
  const { eventStream, push } = useSse(event);
  push("message", { message: "Connection open" });
  return eventStream.send();
});

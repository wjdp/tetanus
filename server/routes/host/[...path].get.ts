import { isDemo } from "~~/server/utils/demo";

const collectorFiles = new Set([
  "install.sh",
  "tetanus-collect",
  "tetanus-collect@.service",
  "tetanus-collect-zfs.timer",
  "tetanus-collect-smart.timer",
  "tetanus-collect-snapshots.timer",
  "zed/all-tetanus.sh",
]);

export default defineEventHandler(async (event) => {
  const path = getRouterParam(event, "path") ?? "";
  if (isDemo() || !collectorFiles.has(path)) {
    throw createError({ statusCode: 404, statusMessage: "Not found" });
  }

  const content = await useStorage("assets:host").getItemRaw(
    path.replaceAll("/", ":"),
  );
  if (content === null || content === undefined) {
    throw createError({ statusCode: 404, statusMessage: "Not found" });
  }

  setResponseHeader(event, "content-type", "text/plain; charset=utf-8");
  return typeof content === "string"
    ? content
    : Buffer.from(content).toString("utf8");
});

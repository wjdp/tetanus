import {
  hostNameExists,
  type LegacyKind,
  legacyPath,
} from "~~/server/services/zfs/paths";

const LEGACY_PATH = /^\/(hosts|zfs|datasets)\/(\d+)\/?$/;

export default defineEventHandler((event) => {
  const [pathname, query] = event.path.split("?", 2);
  const match = LEGACY_PATH.exec(pathname ?? "");
  if (!match) return;
  const [, kind, id] = match as unknown as [string, LegacyKind, string];
  if (kind === "hosts" && hostNameExists(id)) return;
  const target = legacyPath(kind, Number(id));
  if (!target) return;
  return sendRedirect(event, query ? `${target}?${query}` : target, 302);
});

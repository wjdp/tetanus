import type { Parser } from "#shared/ingest";
import { ParseError } from "./parseError";

export interface UdevResult {
  properties: Record<string, string>;
  symlinks: string[];
  aliases: string[];
  byId: string[];
  device: string | null;
}

function decodeHexEscapes(value: string): string {
  return value.replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  );
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

export const parse: Parser<UdevResult> = (body, meta) => {
  if (body.trim() === "") throw new ParseError("Empty udev body");

  const properties: Record<string, string> = {};
  const symlinks: string[] = [];
  const aliases: string[] = [];
  const byId: string[] = [];

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "") continue;
    const type = line[0];
    const rest = line.slice(2);

    if (type === "S") {
      symlinks.push(rest);
      if (rest.startsWith("disk/by-vdev/")) aliases.push(basename(rest));
      if (rest.startsWith("disk/by-id/")) byId.push(basename(rest));
      continue;
    }

    if (type === "E") {
      const separator = rest.indexOf("=");
      if (separator === -1) {
        throw new ParseError(`E line is not KEY=value: ${line}`);
      }
      const key = rest.slice(0, separator);
      const value = rest.slice(separator + 1);
      properties[key] = key.endsWith("_ENC") ? decodeHexEscapes(value) : value;
    }

    // I:, L:, W:, G:, Q:, V: and any other prefix are ignored.
  }

  return {
    data: {
      properties,
      symlinks,
      aliases,
      byId,
      device: meta.device ?? null,
    },
    summary: {
      properties: Object.keys(properties).length,
      symlinks: symlinks.length,
      aliases: aliases.length,
    },
  };
};

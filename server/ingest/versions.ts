import type { Parser } from "#shared/ingest";
import { ParseError } from "./parseError";

export type ToolVersions = Record<string, string>;

const QUOTED = /^(["'])(.*)\1$/;

function unquote(value: string) {
  return value.match(QUOTED)?.[2] ?? value;
}

function isIgnorable(line: string) {
  return line === "" || line.startsWith("#");
}

export const parse: Parser<ToolVersions> = (body) => {
  const versions: ToolVersions = {};
  for (const [index, rawLine] of body.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (isIgnorable(line)) continue;
    const separator = line.indexOf("=");
    const key = line.slice(0, separator).trim();
    if (separator === -1 || key === "") {
      throw new ParseError(`Line ${index + 1} is not KEY=value: ${line}`);
    }
    versions[key] = unquote(line.slice(separator + 1).trim());
  }
  return { data: versions, summary: { keys: Object.keys(versions).length } };
};

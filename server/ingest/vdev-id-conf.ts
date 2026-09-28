import type { Parser } from "#shared/ingest";
import { ParseError } from "./parseError";

export interface VdevIdAlias {
  alias: string;
  target: string;
}

export interface VdevIdConfResult {
  aliases: VdevIdAlias[];
  ignoredDirectives: number;
}

function basename(target: string): string {
  return target.slice(target.lastIndexOf("/") + 1);
}

export const parse: Parser<VdevIdConfResult> = (body) => {
  if (body.trim() === "") throw new ParseError("Empty vdev_id.conf body");

  const aliases: VdevIdAlias[] = [];
  const seen = new Set<string>();
  let ignoredDirectives = 0;

  for (const [index, rawLine] of body.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;

    const fields = line.split(/\s+/);
    const directive = fields[0];

    if (directive === "alias") {
      const [, alias, target] = fields;
      if (!alias || !target) {
        throw new ParseError(
          `Line ${index + 1} is not alias <name> <target>: ${line}`,
        );
      }
      if (seen.has(alias)) {
        throw new ParseError(`Duplicate alias on line ${index + 1}: ${alias}`);
      }
      seen.add(alias);
      aliases.push({ alias, target: basename(target) });
      continue;
    }

    ignoredDirectives += 1;
  }

  return {
    data: { aliases, ignoredDirectives },
    summary: { aliases: aliases.length },
  };
};

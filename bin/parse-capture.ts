// Runs every payload of a `tetanus-collect --dry-run` capture through its server parser
// and prints a Markdown report. Exits 1 if any payload fails to parse.
//
// Usage: tsx --tsconfig .nuxt/tsconfig.server.json bin/parse-capture.ts [--label <name>] <collect.txt>
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { ingestMetaSchema, isIngestSource } from "#shared/ingest";
import { PARSERS } from "../server/ingest/registry";

type Outcome = "ok" | "command failed" | "parse error";

interface Row {
  source: string;
  query: string;
  outcome: Outcome;
  detail: string;
}

function payloads(capture: string) {
  const parts = capture.split(/^### POST (\S+)\n/m);
  const result: { url: URL; body: string }[] = [];
  for (let index = 1; index < parts.length; index += 2) {
    result.push({
      url: new URL(parts[index] ?? ""),
      body: (parts[index + 1] ?? "").replace(/\n$/, ""),
    });
  }
  return result;
}

function oneLine(text: string, limit = 120) {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > limit ? `${line.slice(0, limit)}…` : line;
}

function check(url: URL, body: string): Row {
  const source = url.pathname.split("/").pop() ?? "";
  const query = url.search.slice(1);
  const row = (outcome: Outcome, detail: string) => ({
    source,
    query,
    outcome,
    detail,
  });
  if (!isIngestSource(source)) return row("parse error", "unknown source");
  try {
    const meta = ingestMetaSchema.parse(Object.fromEntries(url.searchParams));
    if (meta.failed !== undefined) {
      return row("command failed", `exit ${meta.failed}: ${oneLine(body)}`);
    }
    const { summary } = PARSERS[source](body, meta);
    return row("ok", oneLine(JSON.stringify(summary)));
  } catch (error) {
    return row("parse error", oneLine(String(error)));
  }
}

const { values, positionals } = parseArgs({
  options: { label: { type: "string" } },
  allowPositionals: true,
});
const [file] = positionals;
if (!file) {
  console.error("usage: parse-capture.ts [--label <name>] <collect.txt>");
  process.exit(2);
}

const capture = readFileSync(file, "utf8");
const rows = payloads(capture).map(({ url, body }) => check(url, body));
const versions = capture.match(/^### POST \S+\/versions\n([\s\S]*?)\n(?=### POST|$)/m)?.[1] ?? "";
const count = (outcome: Outcome) => rows.filter((r) => r.outcome === outcome).length;
const icon: Record<Outcome, string> = {
  ok: "✅",
  "command failed": "⚠️",
  "parse error": "❌",
};

console.log(`### ${values.label ?? file}\n`);
console.log(`\`\`\`\n${versions.trim()}\n\`\`\`\n`);
console.log(
  `${count("ok")} ok, ${count("command failed")} command failed, ${count("parse error")} parse errors\n`,
);
console.log("| | source | query | detail |\n| --- | --- | --- | --- |");
for (const r of rows) {
  const cells = [icon[r.outcome], r.source, r.query, r.detail].map((cell) =>
    cell.replaceAll("|", "\\|"),
  );
  console.log(`| ${cells.join(" | ")} |`);
}
console.log();

process.exit(count("parse error") > 0 || rows.length === 0 ? 1 : 0);

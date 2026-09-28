import type { Parser } from "#shared/ingest";
import { ParseError } from "./parseError";

export interface ZpoolHistoryUser {
  uid: number;
  name: string;
}

export interface ZpoolHistoryEntry {
  pool: string | null;
  /** ISO string built by treating the local `YYYY-MM-DD.HH:MM:SS` timestamp as UTC. */
  at: string;
  /** The timestamp exactly as printed. */
  timestamp: string;
  internal: boolean;
  txg: number | null;
  text: string;
  user: ZpoolHistoryUser | null;
  host: string | null;
}

export interface ZpoolHistoryResult {
  entries: ZpoolHistoryEntry[];
}

const HISTORY_HEADER_RE = /^History for '([^']+)':$/;
const TIMESTAMP_RE = /^(\d{4})-(\d{2})-(\d{2})\.(\d{2}):(\d{2}):(\d{2}) (.*)$/;
const INTERNAL_RE = /^\[txg:(\d+)\] (.*?)(?:\s+\[on (\S+)\])?$/;
const COMMAND_SUFFIX_RE = /^(.*?) \[user (\d+) \(([^)]*)\) on ([^:]+):linux\]$/;
const CONTINUATION_USER_RE = /^\[user (\d+) \(([^)]*)\) on ([^:]+):linux\]$/;

function isoFromLocalTimestamp(
  year: string,
  month: string,
  day: string,
  hour: string,
  minute: string,
  second: string,
): string {
  return new Date(
    Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
    ),
  ).toISOString();
}

export const parse: Parser<ZpoolHistoryResult> = (body) => {
  const normalised = body.replace(/\r\n/g, "\n");
  if (normalised.trim() === "") {
    throw new ParseError("Empty zpool-history body");
  }

  const entries: ZpoolHistoryEntry[] = [];
  let pool: string | null = null;
  let current: ZpoolHistoryEntry | null = null;
  let continuationLines: string[] = [];

  function flush() {
    if (current) {
      current.text = [current.text, ...continuationLines]
        .filter((line) => line !== "")
        .join("\n");
      entries.push(current);
    }
    current = null;
    continuationLines = [];
  }

  for (const line of normalised.split("\n")) {
    const headerMatch = line.match(HISTORY_HEADER_RE);
    if (headerMatch) {
      flush();
      pool = headerMatch[1] ?? null;
      continue;
    }

    const tsMatch = line.match(TIMESTAMP_RE);
    if (tsMatch) {
      flush();
      const [, year, month, day, hour, minute, second, rest] = tsMatch;
      if (
        !year ||
        !month ||
        !day ||
        !hour ||
        !minute ||
        !second ||
        rest === undefined
      ) {
        continue;
      }
      const timestamp = `${year}-${month}-${day}.${hour}:${minute}:${second}`;
      const at = isoFromLocalTimestamp(year, month, day, hour, minute, second);

      const internalMatch = rest.match(INTERNAL_RE);
      if (internalMatch) {
        const [, txg, text, host] = internalMatch;
        current = {
          pool,
          at,
          timestamp,
          internal: true,
          txg: Number(txg),
          text: text ?? "",
          user: null,
          host: host ?? null,
        };
        continue;
      }

      const commandMatch = rest.match(COMMAND_SUFFIX_RE);
      if (commandMatch) {
        const [, text, uid, name, host] = commandMatch;
        current = {
          pool,
          at,
          timestamp,
          internal: false,
          txg: null,
          text: text ?? "",
          user: { uid: Number(uid), name: name ?? "" },
          host: host ?? null,
        };
        continue;
      }

      current = {
        pool,
        at,
        timestamp,
        internal: false,
        txg: null,
        text: rest,
        user: null,
        host: null,
      };
      continue;
    }

    // A blank or indented line: continuation of the previous entry, or, if the fixture
    // was truncated mid-entry (e.g. `tail -n 500`), an orphan with nothing to attach to.
    if (current === null || line.trim() === "") continue;

    const userMatch = line.trim().match(CONTINUATION_USER_RE);
    if (userMatch) {
      const [, uid, name, host] = userMatch;
      current.user = { uid: Number(uid), name: name ?? "" };
      current.host = host ?? null;
      continue;
    }
    continuationLines.push(line);
  }
  flush();

  if (entries.length === 0) {
    throw new ParseError("No zpool-history entries found");
  }

  const pools = new Set(
    entries.map((entry) => entry.pool).filter((p): p is string => p !== null),
  ).size;

  return { data: { entries }, summary: { entries: entries.length, pools } };
};

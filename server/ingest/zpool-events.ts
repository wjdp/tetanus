import type { Parser } from "#shared/ingest";
import { ParseError } from "./parseError";
import type { ZfsEvent } from "./zfsEvent";

export interface ZpoolEventsResult {
  events: ZfsEvent[];
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

// "Mon DD YYYY HH:MM:SS.nnnnnnnnn<tab-or-space><class>"
const HEADER_RE = /^(\S+\s+\d{1,2}\s+\d{4}\s+\d{2}:\d{2}:\d{2}\.\d+)\s+(\S+)$/;
const HEADER_TIMESTAMP_RE =
  /^(\w{3})\s+(\d{1,2})\s+(\d{4})\s+(\d{2}):(\d{2}):(\d{2})\.(\d+)$/;

type NvValue = string | string[] | NvNode;
interface NvNode {
  [key: string]: NvValue;
}

function decodeScalar(raw: string): string | string[] {
  if (raw === "") return "";

  const quoted = raw.match(/^"(.*)"(?:\s*\(0x[0-9a-fA-F]+\))?$/);
  if (quoted) return quoted[1] ?? "";

  const tokens = raw.split(/\s+/);
  if (tokens.every((token) => /^0x[0-9a-fA-F]+$/.test(token))) {
    const decimals = tokens.map((token) => BigInt(token).toString());
    return decimals.length === 1 ? (decimals[0] ?? "") : decimals;
  }

  return raw;
}

function flatten(node: NvNode, prefix = ""): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string" || Array.isArray(value)) {
      out[path] = value;
    } else {
      Object.assign(out, flatten(value, path));
    }
  }
  return out;
}

function atFromHeaderTimestamp(headerLine: string, timestamp: string): string {
  const match = timestamp.match(HEADER_TIMESTAMP_RE);
  if (!match) {
    throw new ParseError(`Unrecognised zpool-events header: ${headerLine}`);
  }
  const [, mon, day, year, hour, minute, second, frac] = match;
  const monthIndex = mon ? MONTHS.indexOf(mon) : -1;
  if (monthIndex === -1 || !day || !year || !hour || !minute || !second) {
    throw new ParseError(`Unrecognised zpool-events header: ${headerLine}`);
  }
  const millis = Number((frac ?? "0").slice(0, 3).padEnd(3, "0"));
  return new Date(
    Date.UTC(
      Number(year),
      monthIndex,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
      millis,
    ),
  ).toISOString();
}

function atFromTimeField(time: string | string[] | undefined): string | null {
  if (!Array.isArray(time) || time.length !== 2) return null;
  const [secondsStr, nanosecondsStr] = time;
  const seconds = Number(secondsStr);
  const nanoseconds = Number(nanosecondsStr);
  if (!Number.isFinite(seconds) || !Number.isFinite(nanoseconds)) return null;
  return new Date(seconds * 1000 + Math.round(nanoseconds / 1e6)).toISOString();
}

interface RawEvent {
  headerLine: string;
  fields: NvNode;
}

function parseBlocks(body: string): RawEvent[] {
  const events: RawEvent[] = [];
  let current: RawEvent | null = null;
  let stack: NvNode[] = [];

  for (const line of body.split("\n")) {
    if (line.trim() === "") continue;

    if (!/^\s/.test(line)) {
      current = { headerLine: line, fields: {} };
      events.push(current);
      stack = [current.fields];
      continue;
    }

    if (!current) continue; // orphan continuation with nothing to attach to
    const trimmed = line.trim();

    const endMatch = trimmed.match(/^\(end \S+\)$/);
    if (endMatch) {
      if (stack.length > 1) stack.pop();
      continue;
    }

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const valueRaw = trimmed.slice(eqIndex + 1).trim();
    const top = stack[stack.length - 1];
    if (!top) continue;

    if (valueRaw === "(embedded nvlist)") {
      const nested: NvNode = {};
      top[key] = nested;
      stack.push(nested);
      continue;
    }
    top[key] = decodeScalar(valueRaw);
  }

  return events;
}

export const parse: Parser<ZpoolEventsResult> = (body) => {
  const normalised = body.replace(/\r\n/g, "\n");
  if (normalised.trim() === "") {
    throw new ParseError("Empty zpool-events body");
  }

  const raw = parseBlocks(normalised);
  if (raw.length === 0) {
    throw new ParseError("No zpool events found");
  }

  const events: ZfsEvent[] = raw.map(({ headerLine, fields }) => {
    const headerMatch = headerLine.match(HEADER_RE);
    if (!headerMatch) {
      throw new ParseError(`Unrecognised zpool-events header: ${headerLine}`);
    }
    const [, headerTimestamp, headerClass] = headerMatch;

    const eidValue = fields.eid;
    const eid =
      typeof eidValue === "string" && eidValue !== "" ? Number(eidValue) : null;

    const classValue = fields.class;
    const eventClass =
      typeof classValue === "string" ? classValue : (headerClass ?? "");

    const poolGuidValue = fields.pool_guid;
    const poolGuid = typeof poolGuidValue === "string" ? poolGuidValue : null;

    const vdevGuidValue = fields.vdev_guid;
    const vdevGuid = typeof vdevGuidValue === "string" ? vdevGuidValue : null;

    const poolValue = fields.pool;
    const pool = typeof poolValue === "string" ? poolValue : null;

    const time = fields.time;
    const at =
      atFromTimeField(
        typeof time === "string" || Array.isArray(time) ? time : undefined,
      ) ?? atFromHeaderTimestamp(headerLine, headerTimestamp ?? "");

    const rest = { ...fields };
    delete rest.eid;
    delete rest.class;
    delete rest.pool;
    delete rest.pool_guid;
    delete rest.vdev_guid;
    delete rest.time;

    return {
      eid,
      class: eventClass,
      at,
      header: headerLine,
      poolGuid,
      vdevGuid,
      pool,
      fields: flatten(rest),
    };
  });

  const classes = new Set(events.map((event) => event.class)).size;
  const firstEid = events[0]?.eid ?? 0;
  const lastEid = events[events.length - 1]?.eid ?? 0;

  return {
    data: { events },
    summary: { events: events.length, classes, firstEid, lastEid },
  };
};

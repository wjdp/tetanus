import type { Parser } from "#shared/ingest";
import { ParseError } from "./parseError";
import type { ZfsEvent } from "./zfsEvent";

export interface ZedEventResult {
  event: ZfsEvent;
}

const HEX_RE = /^0[xX][0-9a-fA-F]+$/;

function decodeGuid(value: string): string {
  return HEX_RE.test(value) ? BigInt(value).toString() : value;
}

function decodeEid(value: string): number {
  return HEX_RE.test(value) ? Number(BigInt(value)) : Number(value);
}

const EXTRACTED_KEYS = new Set([
  "ZEVENT_EID",
  "ZEVENT_CLASS",
  "ZEVENT_TIME_STRING",
  "ZEVENT_TIME_SECS",
  "ZEVENT_TIME_NSECS",
  "ZEVENT_POOL_GUID",
  "ZEVENT_VDEV_GUID",
  "ZEVENT_POOL",
]);

export const parse: Parser<ZedEventResult> = (body) => {
  const normalised = body.replace(/\r\n/g, "\n");
  if (normalised.trim() === "") {
    throw new ParseError("Empty zed-event body");
  }

  const raw: Record<string, string> = {};
  for (const line of normalised.split("\n")) {
    if (line.trim() === "" || !line.startsWith("ZEVENT_")) continue;
    const eqIndex = line.indexOf("=");
    if (eqIndex === -1) continue;
    const key = line.slice(0, eqIndex);
    raw[key] = line.slice(eqIndex + 1);
  }

  const eidRaw = raw.ZEVENT_EID;
  if (eidRaw === undefined) {
    throw new ParseError("zed-event body is missing ZEVENT_EID");
  }
  const classRaw = raw.ZEVENT_CLASS;
  if (classRaw === undefined) {
    throw new ParseError("zed-event body is missing ZEVENT_CLASS");
  }

  let at: string;
  if (raw.ZEVENT_TIME_SECS !== undefined) {
    const seconds = Number(raw.ZEVENT_TIME_SECS);
    const nanoseconds =
      raw.ZEVENT_TIME_NSECS !== undefined ? Number(raw.ZEVENT_TIME_NSECS) : 0;
    if (!Number.isFinite(seconds) || !Number.isFinite(nanoseconds)) {
      throw new ParseError(
        `Unparseable ZEVENT_TIME_SECS/ZEVENT_TIME_NSECS: ${raw.ZEVENT_TIME_SECS} ${raw.ZEVENT_TIME_NSECS}`,
      );
    }
    at = new Date(seconds * 1000 + Math.round(nanoseconds / 1e6)).toISOString();
  } else if (raw.ZEVENT_TIME_STRING !== undefined) {
    const parsed = new Date(raw.ZEVENT_TIME_STRING);
    if (Number.isNaN(parsed.getTime())) {
      throw new ParseError(
        `Unparseable ZEVENT_TIME_STRING: ${raw.ZEVENT_TIME_STRING}`,
      );
    }
    at = parsed.toISOString();
  } else {
    throw new ParseError(
      "zed-event body has no ZEVENT_TIME_SECS or ZEVENT_TIME_STRING",
    );
  }

  const fields: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (EXTRACTED_KEYS.has(key)) continue;
    fields[key.slice("ZEVENT_".length).toLowerCase()] = value;
  }

  const eid = decodeEid(eidRaw);
  const event: ZfsEvent = {
    eid,
    class: classRaw,
    at,
    poolGuid:
      raw.ZEVENT_POOL_GUID !== undefined
        ? decodeGuid(raw.ZEVENT_POOL_GUID)
        : null,
    vdevGuid:
      raw.ZEVENT_VDEV_GUID !== undefined
        ? decodeGuid(raw.ZEVENT_VDEV_GUID)
        : null,
    pool: raw.ZEVENT_POOL ?? null,
    fields,
  };

  return { data: { event }, summary: { eid, class: event.class } };
};

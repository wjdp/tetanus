import type { StoredPayload } from "./payloads";

export const SMART_FAILED_EXIT_BIT = 8;

export interface AtaAttribute {
  id: number;
  name: string;
  value: number;
  worst: number;
  thresh: number;
  raw: { value: number; string: string };
}

type Json = Record<string, unknown>;

export function parseSmartctl(body: string): Json {
  return JSON.parse(body) as Json;
}

export function serialOf(body: string): string | null {
  try {
    const serial = parseSmartctl(body).serial_number;
    return typeof serial === "string" ? serial : null;
  } catch {
    return null;
  }
}

/** Returns a copy of the payload with its smartctl JSON passed through `edit`. */
export function editSmartctl(
  stored: StoredPayload,
  edit: (json: Json) => void,
): StoredPayload {
  const json = parseSmartctl(stored.body);
  edit(json);
  return { ...stored, body: JSON.stringify(json, null, 2) };
}

export function ataAttributes(json: Json): AtaAttribute[] {
  const table = (json.ata_smart_attributes as { table?: AtaAttribute[] })
    ?.table;
  return Array.isArray(table) ? table : [];
}

export function ataAttribute(json: Json, id: number): AtaAttribute | undefined {
  return ataAttributes(json).find((attribute) => attribute.id === id);
}

export function setAtaRaw(json: Json, id: number, raw: number) {
  const attribute = ataAttribute(json, id);
  if (!attribute) throw new Error(`No ATA attribute ${id}`);
  attribute.raw = { value: raw, string: String(raw) };
}

export function failHealth(stored: StoredPayload): StoredPayload {
  const edited = editSmartctl(stored, (json) => {
    json.smart_status = { ...(json.smart_status as Json), passed: false };
  });
  return {
    ...edited,
    meta: {
      ...edited.meta,
      exitStatus: (edited.meta.exitStatus ?? 0) | SMART_FAILED_EXIT_BIT,
    },
  };
}

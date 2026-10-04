import type { Parser } from "#shared/ingest";
import { ParseError } from "./parseError";

export interface EnclosureSlot {
  element: string;
  slot: number;
  status: string | null;
  locate: boolean | null;
  fault: boolean | null;
  device: string | null;
  devnum: string | null;
}

export interface Enclosure {
  name: string;
  id: string | null;
  vendor: string | null;
  model: string | null;
  components: number | null;
  slots: EnclosureSlot[];
}

export interface EnclosureResult {
  enclosures: Enclosure[];
}

interface ElementDraft {
  slot?: number;
  status?: string;
  locate?: boolean;
  fault?: boolean;
  device?: string;
  devnum?: string;
}

const DEVICE_DEV = /^device\/block\/([^/]+)\/dev$/;

function integer(value: string): number | undefined {
  return /^\d+$/.test(value) ? Number(value) : undefined;
}

function flag(value: string): boolean | undefined {
  if (value === "0") return false;
  if (value === "1") return true;
  return undefined;
}

function normaliseId(value: string): string {
  return value.toLowerCase().replace(/^0x/, "");
}

function draftEnclosure(name: string) {
  return {
    enclosure: {
      name,
      id: null,
      vendor: null,
      model: null,
      components: null,
      slots: [],
    } as Enclosure,
    elements: new Map<string, ElementDraft>(),
  };
}

function applyElementFile(element: ElementDraft, file: string, value: string) {
  const device = DEVICE_DEV.exec(file);
  if (device) {
    element.device = device[1];
    element.devnum = value;
  } else if (file === "slot") element.slot = integer(value);
  else if (file === "status") element.status = value;
  else if (file === "locate") element.locate = flag(value);
  else if (file === "fault") element.fault = flag(value);
}

export const parse: Parser<EnclosureResult> = (body) => {
  const drafts = new Map<string, ReturnType<typeof draftEnclosure>>();

  for (const [index, rawLine] of body.split(/\r?\n/).entries()) {
    if (rawLine.trim() === "") continue;
    const tab = rawLine.indexOf("\t");
    const path = rawLine.slice(0, tab);
    const separator = path.indexOf("/");
    if (tab === -1 || separator <= 0) {
      throw new ParseError(
        `Line ${index + 1} is not <enclosure>/<file>\\t<value>: ${rawLine}`,
      );
    }
    const name = path.slice(0, separator);
    const file = path.slice(separator + 1);
    const value = rawLine.slice(tab + 1).trim();

    let draft = drafts.get(name);
    if (!draft) {
      draft = draftEnclosure(name);
      drafts.set(name, draft);
    }
    const { enclosure, elements } = draft;

    if (file === "id") enclosure.id = normaliseId(value) || null;
    else if (file === "components")
      enclosure.components = integer(value) ?? null;
    else if (file === "device/vendor") enclosure.vendor = value || null;
    else if (file === "device/model") enclosure.model = value || null;
    else {
      const elementSeparator = file.indexOf("/");
      if (elementSeparator <= 0) continue;
      const elementName = file.slice(0, elementSeparator);
      let element = elements.get(elementName);
      if (!element) {
        element = {};
        elements.set(elementName, element);
      }
      applyElementFile(element, file.slice(elementSeparator + 1), value);
    }
  }

  const enclosures = [...drafts.values()].map(({ enclosure, elements }) => ({
    ...enclosure,
    slots: [...elements.entries()]
      .filter(([, element]) => element.slot !== undefined)
      .map(([elementName, element]) => ({
        element: elementName,
        slot: element.slot as number,
        status: element.status ?? null,
        locate: element.locate ?? null,
        fault: element.fault ?? null,
        device: element.device ?? null,
        devnum: element.devnum ?? null,
      }))
      .sort((a, b) => a.slot - b.slot),
  }));

  const slots = enclosures.flatMap((enclosure) => enclosure.slots);
  return {
    data: { enclosures },
    summary: {
      enclosures: enclosures.length,
      slots: slots.length,
      occupied: slots.filter((slot) => slot.device !== null).length,
    },
  };
};

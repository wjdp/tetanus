import { attributeClass } from "#shared/smart/classification";
import type {
  AcceptanceKind,
  AttributeDisplayStatus,
} from "#shared/smart/status";
import type { DotShape, StatusColour } from "~/utils/vocabulary";

interface RankedAttribute {
  attrId: string;
  displayStatus: AttributeDisplayStatus;
  failureRate: number | null;
}

interface NotedAttribute extends RankedAttribute {
  reason: string | null;
  acceptance: { note: string } | null;
}

const NOTABLE_CONTEXT_RATE = 0.1;

export const CONTEXT_RATE_NOTE =
  "Backblaze fleet rate for this value. Context only: usage and environment attributes do not affect disk status.";

export function isNotableContextRate(attribute: {
  attrId: string;
  failureRate: number | null;
}): boolean {
  return (
    attributeClass(attribute.attrId) === "context" &&
    attribute.failureRate !== null &&
    attribute.failureRate >= NOTABLE_CONTEXT_RATE
  );
}

const STATUS_GROUP: Record<
  Exclude<AttributeDisplayStatus, "passed">,
  number
> = {
  failed: 0,
  warning: 1,
  acknowledged: 2,
  accepted: 3,
};

function importanceGroup(attribute: RankedAttribute): number {
  if (attribute.displayStatus !== "passed") {
    return STATUS_GROUP[attribute.displayStatus];
  }
  if (attributeClass(attribute.attrId) === "defect") return 4;
  if (isNotableContextRate(attribute)) return 5;
  return 6;
}

const numericId = (attrId: string) =>
  /^\d+$/.test(attrId) ? Number(attrId) : null;

function compareIds(a: string, b: string): number {
  const first = numericId(a);
  const second = numericId(b);
  if (first !== null && second !== null) return first - second;
  if (first !== null) return -1;
  if (second !== null) return 1;
  return 0;
}

export function orderAttributes<T extends RankedAttribute>(
  attributes: T[],
): T[] {
  return [...attributes].sort(
    (a, b) =>
      importanceGroup(a) - importanceGroup(b) || compareIds(a.attrId, b.attrId),
  );
}

export function isShownByDefault(attribute: RankedAttribute): boolean {
  return (
    attributeClass(attribute.attrId) === "defect" ||
    attribute.displayStatus !== "passed" ||
    isNotableContextRate(attribute)
  );
}

export function attributeNote(attribute: NotedAttribute): string | null {
  if (attribute.reason) return attribute.reason;
  if (isNotableContextRate(attribute)) return CONTEXT_RATE_NOTE;
  return attribute.acceptance?.note || null;
}

export function countByStatus(
  attributes: { displayStatus: AttributeDisplayStatus }[],
) {
  const count = (status: AttributeDisplayStatus) =>
    attributes.filter((attribute) => attribute.displayStatus === status).length;
  return {
    failed: count("failed"),
    warning: count("warning"),
    acknowledged: count("acknowledged"),
    accepted: count("accepted"),
  };
}

export interface AttributeStatusDot {
  colour: StatusColour;
  shape: DotShape;
}

export const ATTRIBUTE_STATUS_DOT: Record<
  AttributeDisplayStatus,
  AttributeStatusDot | null
> = {
  passed: null,
  warning: { colour: "warning", shape: "filled" },
  failed: { colour: "error", shape: "filled" },
  acknowledged: { colour: "warning", shape: "filled" },
  accepted: { colour: "warning", shape: "hollow" },
};

export interface AcceptanceKindVocabulary {
  action: string;
  verb: string;
  noun: string;
  icon: string;
  description: string;
  notePlaceholder: string;
}

export const ACCEPTANCE_KIND_VOCABULARY: Record<
  AcceptanceKind,
  AcceptanceKindVocabulary
> = {
  acknowledge: {
    action: "Acknowledge",
    verb: "acknowledged",
    noun: "acknowledgement",
    icon: "i-lucide-eye",
    description:
      "Still a fault, but the disk drops to a warning. Back to its real status if the value rises.",
    notePlaceholder: "What you are doing about it (optional)",
  },
  accept: {
    action: "Accept",
    verb: "accepted",
    noun: "acceptance",
    icon: "i-lucide-shield-check",
    description:
      "Normal for this disk: stops counting towards its status. Back to its real status if the value rises.",
    notePlaceholder: "Why this is acceptable (optional)",
  },
};

export type AttributeTrend = "new" | "stable" | "worsening" | "improving";

export const ATTRIBUTE_TREND_COLOUR: Record<AttributeTrend, StatusColour> = {
  new: "neutral",
  stable: "neutral",
  worsening: "warning",
  improving: "success",
};

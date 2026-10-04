import type { Disposal, DisposalKind } from "#shared/disk";
import type { StatusColour } from "./colour";

export interface DisposalVocabulary {
  colour: StatusColour;
  icon: string;
  label: string;
}

export const DISPOSAL_VOCABULARY: Record<DisposalKind, DisposalVocabulary> = {
  sold: { colour: "neutral", icon: "i-lucide-banknote", label: "Sold" },
  rma: { colour: "neutral", icon: "i-lucide-package-open", label: "RMA" },
  recycled: { colour: "neutral", icon: "i-lucide-recycle", label: "Recycled" },
  "given-away": {
    colour: "neutral",
    icon: "i-lucide-gift",
    label: "Given away",
  },
};

export interface DisposalReplacement {
  replacedByDiskId: number | null;
  replacedByLabel?: string | null;
}

export function disposalLabel(
  disposal: Pick<Disposal, "kind">,
  { replacedByDiskId, replacedByLabel }: DisposalReplacement,
): string {
  const { label } = DISPOSAL_VOCABULARY[disposal.kind];
  if (disposal.kind !== "rma") return label;
  if (replacedByDiskId === null) return `${label} · awaiting replacement`;
  return `${label} · replaced by ${replacedByLabel ?? "another disk"}`;
}

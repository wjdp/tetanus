import type { Purpose } from "#shared/usage";

export interface PurposeBadgeProps {
  label: string;
  color: "neutral";
  variant: "outline";
  size: "xs";
}

export const PURPOSE_BADGE: Record<Purpose, PurposeBadgeProps> = {
  system: { label: "sys", color: "neutral", variant: "outline", size: "xs" },
  other: { label: "other", color: "neutral", variant: "outline", size: "xs" },
};

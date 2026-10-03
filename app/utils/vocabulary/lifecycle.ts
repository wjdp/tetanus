import type { EffectiveDiskState } from "#shared/disk";
import type { StatusColour } from "./colour";

export interface LifecycleVocabulary {
  colour: StatusColour;
  icon: string;
  label: string;
}

export const LIFECYCLE_VOCABULARY: Record<
  EffectiveDiskState,
  LifecycleVocabulary
> = {
  "in-use": { colour: "neutral", icon: "i-lucide-activity", label: "In use" },
  spare: { colour: "neutral", icon: "i-lucide-life-buoy", label: "Spare" },
  missing: { colour: "error", icon: "i-lucide-search", label: "Missing" },
  removed: { colour: "neutral", icon: "i-lucide-unplug", label: "Removed" },
  unseen: { colour: "neutral", icon: "i-lucide-eye-off", label: "Unseen" },
  dead: { colour: "neutral", icon: "i-lucide-skull", label: "Dead" },
  retired: { colour: "neutral", icon: "i-lucide-archive", label: "Retired" },
};

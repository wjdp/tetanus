import {
  CAPACITY_ERROR_PERCENT,
  CAPACITY_WARNING_PERCENT,
} from "#shared/capacity";
import type { StatusColour } from "./colour";

export { CAPACITY_ERROR_PERCENT, CAPACITY_WARNING_PERCENT };

export function capacityColour(capacityPercent: number | null): StatusColour {
  if (capacityPercent === null) return "neutral";
  if (capacityPercent >= CAPACITY_ERROR_PERCENT) return "error";
  if (capacityPercent >= CAPACITY_WARNING_PERCENT) return "warning";
  return "neutral";
}

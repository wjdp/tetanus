import { DEVICE_STATUS_LABELS, type DeviceStatus } from "#shared/smart/status";
import type { StatusColour } from "./colour";

export type DotShape = "filled" | "hollow";

export interface DeviceStatusVocabulary {
  colour: StatusColour;
  shape: DotShape;
  label: string;
}

export const DEVICE_STATUS_VOCABULARY: Record<
  DeviceStatus,
  DeviceStatusVocabulary
> = {
  passed: {
    colour: "success",
    shape: "filled",
    label: DEVICE_STATUS_LABELS.passed,
  },
  warning: {
    colour: "warning",
    shape: "filled",
    label: DEVICE_STATUS_LABELS.warning,
  },
  failed: {
    colour: "error",
    shape: "filled",
    label: DEVICE_STATUS_LABELS.failed,
  },
  unknown: {
    colour: "neutral",
    shape: "hollow",
    label: DEVICE_STATUS_LABELS.unknown,
  },
};

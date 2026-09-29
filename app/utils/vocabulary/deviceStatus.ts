import type { DeviceStatus } from "#shared/smart/status";
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
  passed: { colour: "success", shape: "filled", label: "SMART passed" },
  warning: { colour: "warning", shape: "filled", label: "SMART warning" },
  failed: { colour: "error", shape: "filled", label: "SMART failed" },
  unknown: { colour: "neutral", shape: "hollow", label: "SMART unknown" },
};

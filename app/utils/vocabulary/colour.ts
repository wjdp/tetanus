export type StatusColour = "neutral" | "warning" | "error" | "success" | "info";

export const COLOUR_SEVERITY: Record<StatusColour, number> = {
  neutral: 0,
  success: 1,
  info: 2,
  warning: 3,
  error: 4,
};

export function worstColour(...colours: StatusColour[]): StatusColour {
  return colours.reduce<StatusColour>(
    (worst, colour) =>
      COLOUR_SEVERITY[colour] > COLOUR_SEVERITY[worst] ? colour : worst,
    "neutral",
  );
}

export const STATUS_DOT_CLASS: Record<StatusColour, string> = {
  neutral: "bg-(--ui-border-accented)",
  success: "bg-success",
  info: "bg-info",
  warning: "bg-warning",
  error: "bg-error",
};

export const STATUS_RING_CLASS: Record<StatusColour, string> = {
  neutral: "border-(--ui-border-accented)",
  success: "border-success",
  info: "border-info",
  warning: "border-warning",
  error: "border-error",
};

export const STATUS_TEXT_CLASS: Record<StatusColour, string> = {
  neutral: "text-dimmed",
  success: "text-success",
  info: "text-info",
  warning: "text-warning",
  error: "text-error",
};

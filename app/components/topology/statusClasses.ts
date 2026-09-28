import type { StatusColour } from "~/utils/statusColour";

export const STATUS_DOT_CLASS: Record<StatusColour, string> = {
  neutral: "bg-(--ui-border-accented)",
  success: "bg-success",
  info: "bg-info",
  warning: "bg-warning",
  error: "bg-error",
};

export const STATUS_TEXT_CLASS: Record<StatusColour, string> = {
  neutral: "text-dimmed",
  success: "text-success",
  info: "text-info",
  warning: "text-warning",
  error: "text-error",
};

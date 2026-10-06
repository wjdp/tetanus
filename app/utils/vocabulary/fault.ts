import type {
  FaultAction,
  FaultKind,
  FaultSubject,
  FaultView,
} from "#shared/faults";
import type { StatusColour } from "./colour";

export type FaultGutterColour = Extract<StatusColour, "error" | "warning">;

export function faultGutterColour(
  fault: Pick<FaultView, "state" | "severity">,
): FaultGutterColour | null {
  if (fault.state === "open") return fault.severity;
  if (fault.state === "acknowledged") return "warning";
  return null;
}

export const FAULT_GUTTER_CLASS: Record<FaultGutterColour, string> = {
  error: "border-s-error",
  warning: "border-s-warning",
};

export function faultHostLabel(fault: Pick<FaultView, "subject">): string {
  return fault.subject.hostName ?? fault.subject.label;
}

const DISK_FAULT_TABS: Partial<Record<FaultKind, string>> = {
  "smart-attribute": "smart",
  "smart-health-failed": "smart",
  "temperature-high": "smart",
  "smart-counters-reset": "farm",
};

export function faultSubjectPath(
  subject: FaultSubject,
  kind?: FaultKind,
): string | null {
  if (subject.type === "disk" && subject.path) {
    const tab = kind && DISK_FAULT_TABS[kind];
    return tab ? `${subject.path}?tab=${tab}` : subject.path;
  }
  return subject.path;
}

export function faultDiskPath(
  fault: Pick<FaultView, "subject" | "data">,
): string | null {
  const { diskId } = fault.data;
  return fault.subject.type === "pool" && typeof diskId === "number"
    ? `/disks/${diskId}`
    : null;
}

export const FAULT_ACTION_VOCABULARY: Record<
  FaultAction,
  {
    label: string;
    colour: "primary" | "warning" | "neutral" | "success";
    icon: string;
  }
> = {
  acknowledge: {
    label: "Acknowledge",
    colour: "primary",
    icon: "i-lucide-eye",
  },
  accept: { label: "Accept", colour: "warning", icon: "i-lucide-shield-check" },
  clear: { label: "Clear", colour: "neutral", icon: "i-lucide-undo-2" },
  resolve: { label: "Resolve", colour: "success", icon: "i-lucide-check" },
};

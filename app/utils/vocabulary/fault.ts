import type { FaultKind, FaultSubject, FaultView } from "#shared/faults";
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
): string {
  if (subject.type === "disk") {
    const tab = kind && DISK_FAULT_TABS[kind];
    return tab ? `/disks/${subject.id}?tab=${tab}` : `/disks/${subject.id}`;
  }
  if (subject.type === "pool") return `/zfs/${subject.id}`;
  if (subject.type === "replication") return `/replications/${subject.id}`;
  return `/hosts/${subject.id}`;
}

export function faultDiskPath(
  fault: Pick<FaultView, "subject" | "data">,
): string | null {
  const { diskId } = fault.data;
  return fault.subject.type === "pool" && typeof diskId === "number"
    ? `/disks/${diskId}`
    : null;
}

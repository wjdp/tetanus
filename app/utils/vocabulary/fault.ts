import type { FaultSubject, FaultView } from "#shared/faults";
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

export function faultSubjectPath(subject: FaultSubject): string {
  if (subject.type === "disk") return `/disks/${subject.id}`;
  if (subject.type === "pool") return `/zfs/${subject.id}`;
  return "/settings/hosts";
}

export function faultDiskPath(
  fault: Pick<FaultView, "subject" | "data">,
): string | null {
  const { diskId } = fault.data;
  return fault.subject.type === "pool" && typeof diskId === "number"
    ? `/disks/${diskId}`
    : null;
}

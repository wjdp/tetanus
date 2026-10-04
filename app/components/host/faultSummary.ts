import type { FaultSubject, FaultView } from "#shared/faults";

export interface SubjectFaultSummary {
  subject: FaultSubject;
  errors: number;
  warnings: number;
}

const subjectKey = (subject: FaultSubject) => `${subject.type}:${subject.id}`;

export function summariseSubjectFaults(
  faults: Pick<FaultView, "subject" | "severity">[],
): SubjectFaultSummary[] {
  const bySubject = new Map<string, SubjectFaultSummary>();
  for (const { subject, severity } of faults) {
    if (subject.type === "host") continue;
    const key = subjectKey(subject);
    const summary = bySubject.get(key) ?? { subject, errors: 0, warnings: 0 };
    if (severity === "error") summary.errors += 1;
    else summary.warnings += 1;
    bySubject.set(key, summary);
  }
  return [...bySubject.values()].sort(
    (a, b) =>
      b.errors - a.errors ||
      b.warnings - a.warnings ||
      a.subject.label.localeCompare(b.subject.label),
  );
}

export function faultCountLabel({ errors, warnings }: SubjectFaultSummary) {
  return [
    errors ? `${errors} ${errors === 1 ? "error" : "errors"}` : null,
    warnings ? `${warnings} ${warnings === 1 ? "warning" : "warnings"}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

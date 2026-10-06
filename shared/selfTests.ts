export type SelfTestOutcome = "passed" | "failed" | "inconclusive";

type ClassifiableSelfTest = { status: string; passed: boolean };

const INCONCLUSIVE_STATUS = /abort|interrupt|progress/i;
const PASSED_STATUS = /^completed( without error)?$/i;
const FAILED_STATUS = /fail|error|damage/i;

const INCONCLUSIVE_LABELS: [RegExp, string][] = [
  [/abort/i, "aborted"],
  [/interrupt/i, "interrupted"],
  [/progress/i, "in progress"],
];

export function selfTestOutcome(test: ClassifiableSelfTest): SelfTestOutcome {
  const status = test.status.trim();
  if (INCONCLUSIVE_STATUS.test(status)) return "inconclusive";
  if (PASSED_STATUS.test(status)) return "passed";
  if (FAILED_STATUS.test(status)) return "failed";
  return test.passed ? "passed" : "failed";
}

export function selfTestResultLabel(test: ClassifiableSelfTest) {
  const outcome = selfTestOutcome(test);
  if (outcome !== "inconclusive") return outcome;
  const match = INCONCLUSIVE_LABELS.find(([pattern]) =>
    pattern.test(test.status),
  );
  return match?.[1] ?? "not completed";
}

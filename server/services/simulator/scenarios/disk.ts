import {
  ataAttribute,
  editSmartctl,
  failHealth,
  parseSmartctl,
  setAtaRaw,
} from "../smartctl";
import { smartctlPayloadOf } from "../subjects";
import { defineScenario, type SubjectOf } from "../types";

function requireSmartctl(subject: SubjectOf<"disk">) {
  const stored = smartctlPayloadOf(subject);
  if (!stored) throw new Error("No smartctl output stored for this disk");
  return stored;
}

function hasAtaAttribute(subject: SubjectOf<"disk">, attrId: number) {
  const stored = smartctlPayloadOf(subject);
  return (
    stored !== undefined &&
    ataAttribute(parseSmartctl(stored.body), attrId) !== undefined
  );
}

function ataRawScenario(options: {
  id: string;
  label: string;
  attrId: number;
  defaultRaw: number;
  description: string;
}) {
  return defineScenario({
    id: options.id,
    label: options.label,
    group: "SMART attributes",
    subjectType: "disk",
    description: options.description,
    applies: (subject) => hasAtaAttribute(subject, options.attrId),
    params: () => [
      {
        key: "raw",
        label: "Raw value",
        kind: "number",
        default: options.defaultRaw,
        min: 0,
      },
    ],
    plan: (subject, params) => ({
      replays: [
        editSmartctl(requireSmartctl(subject), (json) =>
          setAtaRaw(json, options.attrId, Number(params.raw)),
        ),
      ],
    }),
  });
}

export const pendingSectors = ataRawScenario({
  id: "pending-sectors",
  label: "Pending sectors",
  attrId: 197,
  defaultRaw: 8,
  description: "Current_Pending_Sector: sectors waiting to be remapped.",
});

export const healthFailed = defineScenario({
  id: "smart-health-failed",
  label: "SMART health failed",
  group: "Health",
  subjectType: "disk",
  description: "The drive's own overall-health self-assessment fails.",
  applies: (subject) => smartctlPayloadOf(subject) !== undefined,
  plan: (subject) => ({ replays: [failHealth(requireSmartctl(subject))] }),
});

export const DISK_SCENARIOS = [pendingSectors, healthFailed];

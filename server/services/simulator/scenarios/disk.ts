import { attributeClass } from "#shared/smart/classification";
import { resolveTemperatureThresholds } from "#shared/temperature";
import type { StoredPayload } from "../payloads";
import {
  ataAttribute,
  ataAttributes,
  capacityBlocks,
  defaultFailingLba,
  editSmartctl,
  failHealth,
  failSelfTest,
  hasSelfTestLog,
  NVME_CRITICAL_WARNINGS,
  nvmeHealthLog,
  parseSmartctl,
  SELF_TEST_TYPES,
  type SelfTestType,
  setAtaRaw,
  setNvmeCriticalWarning,
  setNvmeMediaErrors,
  setTemperature,
  setWear,
  supportsWear,
} from "../smartctl";
import { smartctlPayloadOf } from "../subjects";
import { defineScenario, type SubjectOf } from "../types";

type Json = ReturnType<typeof parseSmartctl>;

function requireSmartctl(subject: SubjectOf<"disk">) {
  const stored = smartctlPayloadOf(subject);
  if (!stored) throw new Error("No smartctl output stored for this disk");
  return stored;
}

function smartctlJsonOf(subject: SubjectOf<"disk">): Json | undefined {
  const stored = smartctlPayloadOf(subject);
  return stored && parseSmartctl(stored.body);
}

function smartctlSatisfies(
  subject: SubjectOf<"disk">,
  predicate: (json: Json) => boolean,
) {
  const json = smartctlJsonOf(subject);
  return json !== undefined && predicate(json);
}

function requireSmartctlJson(subject: SubjectOf<"disk">) {
  return parseSmartctl(requireSmartctl(subject).body);
}

const editPlan = (subject: SubjectOf<"disk">, edit: (json: Json) => void) => ({
  replays: [editSmartctl(requireSmartctl(subject), edit)],
});

const replayPlan = (replay: StoredPayload) => ({ replays: [replay] });

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
    applies: (subject) =>
      smartctlSatisfies(
        subject,
        (json) => ataAttribute(json, options.attrId) !== undefined,
      ),
    params: () => [
      {
        key: "raw",
        label: "Raw value",
        kind: "number",
        default: options.defaultRaw,
        min: 0,
      },
    ],
    plan: (subject, params) =>
      editPlan(subject, (json) =>
        setAtaRaw(json, options.attrId, Number(params.raw)),
      ),
  });
}

export const pendingSectors = ataRawScenario({
  id: "pending-sectors",
  label: "Pending sectors",
  attrId: 197,
  defaultRaw: 8,
  description: "Current_Pending_Sector: sectors waiting to be remapped.",
});

export const reallocatedSectors = ataRawScenario({
  id: "reallocated-sectors",
  label: "Reallocated sectors",
  attrId: 5,
  defaultRaw: 24,
  description:
    "Reallocated_Sector_Ct: bad sectors remapped to spares. Run again with a higher count to show it worsening.",
});

export const offlineUncorrectable = ataRawScenario({
  id: "offline-uncorrectable",
  label: "Offline uncorrectable",
  attrId: 198,
  defaultRaw: 16,
  description:
    "Offline_Uncorrectable: sectors the offline scan could not read.",
});

export const udmaCrcErrors = ataRawScenario({
  id: "udma-crc-errors",
  label: "UDMA CRC errors",
  attrId: 199,
  defaultRaw: 40,
  description:
    "UDMA_CRC_Error_Count: transfer errors on the link. Points at cabling, not media.",
});

export const commandTimeouts = ataRawScenario({
  id: "command-timeouts",
  label: "Command timeouts",
  attrId: 188,
  defaultRaw: 120,
  description:
    "Command_Timeout: aborted commands. Up to 100 is within the observed normal range.",
});

function defaultAttribute(json: Json) {
  const attributes = ataAttributes(json);
  return (
    attributes.find((attribute) => attributeClass(attribute.id) === "defect") ??
    attributes[0]
  );
}

export const anyAttribute = defineScenario({
  id: "any-attribute",
  label: "Any attribute",
  group: "SMART attributes",
  subjectType: "disk",
  description: "Set the raw value of any ATA attribute on this disk.",
  applies: (subject) =>
    smartctlSatisfies(subject, (json) => ataAttributes(json).length > 0),
  params: (subject) => {
    const json = requireSmartctlJson(subject);
    const initial = defaultAttribute(json);
    return [
      {
        key: "attribute",
        label: "Attribute",
        kind: "select",
        default: String(initial?.id),
        options: ataAttributes(json).map((attribute) => ({
          value: String(attribute.id),
          label: `${attribute.id} ${attribute.name}`,
        })),
      },
      {
        key: "raw",
        label: "Raw value",
        kind: "number",
        default: (initial?.raw.value ?? 0) + 1,
        min: 0,
      },
    ];
  },
  plan: (subject, params) =>
    editPlan(subject, (json) =>
      setAtaRaw(json, Number(params.attribute), Number(params.raw)),
    ),
});

export const healthFailed = defineScenario({
  id: "smart-health-failed",
  label: "SMART health failed",
  group: "Health",
  subjectType: "disk",
  description: "The drive's own overall-health self-assessment fails.",
  applies: (subject) => smartctlPayloadOf(subject) !== undefined,
  plan: (subject) => replayPlan(failHealth(requireSmartctl(subject))),
});

const hasNvmeHealthLog = (json: Json) => nvmeHealthLog(json) !== undefined;

export const nvmeCriticalWarning = defineScenario({
  id: "nvme-critical-warning",
  label: "NVMe critical warning",
  group: "Health",
  subjectType: "disk",
  description:
    "The controller raises a critical warning; smartctl then fails the overall health assessment.",
  applies: (subject) => smartctlSatisfies(subject, hasNvmeHealthLog),
  params: () => [
    {
      key: "bits",
      label: "Warning",
      kind: "select",
      default: String(NVME_CRITICAL_WARNINGS[0].bit),
      options: NVME_CRITICAL_WARNINGS.map(({ bit, label }) => ({
        value: String(bit),
        label,
      })),
    },
  ],
  plan: (subject, params) =>
    replayPlan(
      setNvmeCriticalWarning(requireSmartctl(subject), Number(params.bits)),
    ),
});

export const nvmeMediaErrors = defineScenario({
  id: "nvme-media-errors",
  label: "NVMe media errors",
  group: "Health",
  subjectType: "disk",
  description: "Unrecovered data integrity errors reported by the controller.",
  applies: (subject) => smartctlSatisfies(subject, hasNvmeHealthLog),
  params: () => [
    { key: "count", label: "Count", kind: "number", default: 4, min: 0 },
  ],
  plan: (subject, params) =>
    editPlan(subject, (json) => setNvmeMediaErrors(json, Number(params.count))),
});

export const ssdWearOut = defineScenario({
  id: "ssd-wear-out",
  label: "SSD wear-out",
  group: "Health",
  subjectType: "disk",
  description:
    "Rated endurance nearly used up. NVMe fails its threshold above 100 %.",
  applies: (subject) => smartctlSatisfies(subject, supportsWear),
  params: () => [
    {
      key: "percentageUsed",
      label: "Percentage used",
      kind: "number",
      default: 98,
      min: 0,
      max: 255,
      unit: "%",
    },
  ],
  plan: (subject, params) =>
    editPlan(subject, (json) => setWear(json, Number(params.percentageUsed))),
});

export const selfTestFailed = defineScenario({
  id: "self-test-failed",
  label: "Self-test failed",
  group: "Health",
  subjectType: "disk",
  description: "The latest self-test aborts with a read failure at an LBA.",
  applies: (subject) => smartctlSatisfies(subject, hasSelfTestLog),
  params: (subject) => {
    const json = requireSmartctlJson(subject);
    const blocks = capacityBlocks(json);
    return [
      {
        key: "type",
        label: "Type",
        kind: "select",
        default: "extended",
        options: SELF_TEST_TYPES.map((type) => ({
          value: type,
          label: type === "short" ? "Short" : "Extended",
        })),
      },
      {
        key: "lba",
        label: "First failing LBA",
        kind: "number",
        default: defaultFailingLba(json),
        min: 0,
        ...(blocks === undefined ? {} : { max: blocks - 1 }),
      },
    ];
  },
  plan: (subject, params) =>
    replayPlan(
      failSelfTest(
        requireSmartctl(subject),
        params.type as SelfTestType,
        Number(params.lba),
      ),
    ),
});

function temperatureScenario(options: {
  id: string;
  label: string;
  threshold: "warning" | "error";
  description: string;
}) {
  return defineScenario({
    id: options.id,
    label: options.label,
    group: "Temperature",
    subjectType: "disk",
    description: options.description,
    applies: (subject) => smartctlPayloadOf(subject) !== undefined,
    params: (subject) => [
      {
        key: "celsius",
        label: "Temperature",
        kind: "number",
        default:
          resolveTemperatureThresholds(subject.host, subject.disk.media)[
            options.threshold
          ] + 2,
        min: 1,
        max: 255,
        unit: "°C",
      },
    ],
    plan: (subject, params) =>
      editPlan(subject, (json) => setTemperature(json, Number(params.celsius))),
  });
}

export const runningHot = temperatureScenario({
  id: "temperature-hot",
  label: "Running hot",
  threshold: "warning",
  description: "Above the host's warning threshold for this kind of disk.",
});

export const temperatureCritical = temperatureScenario({
  id: "temperature-critical",
  label: "Critical",
  threshold: "error",
  description: "Above the host's critical threshold for this kind of disk.",
});

export const DISK_SCENARIOS = [
  pendingSectors,
  reallocatedSectors,
  offlineUncorrectable,
  udmaCrcErrors,
  commandTimeouts,
  anyAttribute,
  healthFailed,
  nvmeCriticalWarning,
  nvmeMediaErrors,
  ssdWearOut,
  selfTestFailed,
  runningHot,
  temperatureCritical,
];

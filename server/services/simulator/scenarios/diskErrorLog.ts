import { ataAttributes, editSmartctl } from "../smartctl";
import { defineScenario, type Scenario } from "../types";
import {
  requireSmartctl,
  requireSmartctlJson,
  smartctlSatisfies,
} from "./disk";

type Json = Record<string, unknown>;

function errorLogCount(json: Json): number {
  const log = (json.ata_smart_error_log ?? {}) as Json;
  for (const section of [log.extended, log.summary]) {
    const count = (section as Json | undefined)?.count;
    if (typeof count === "number") return count;
  }
  return 0;
}

function setErrorLogCount(json: Json, count: number) {
  const log = (json.ata_smart_error_log ?? {}) as Json;
  const section = (log.extended ?? log.summary) as Json | undefined;
  if (section) section.count = count;
  else log.extended = { revision: 1, sectors: 1, count };
  json.ata_smart_error_log = log;
}

export const errorLogGrowth = defineScenario({
  id: "error-log-growth",
  label: "Error log growth",
  group: "SMART attributes",
  subjectType: "disk",
  description:
    "The ATA device error log count rises by the given number of errors between two readings. Opens an error log growth fault, or adds the rise to the disk's defect fault if it has one.",
  applies: (subject) =>
    smartctlSatisfies(subject, (json) => ataAttributes(json).length > 0),
  params: () => [
    { key: "errors", label: "Errors", kind: "number", default: 3, min: 1 },
  ],
  plan: (subject, params) => {
    const stored = requireSmartctl(subject);
    const current = errorLogCount(requireSmartctlJson(subject));
    return {
      replays: [current, current + Number(params.errors)].map((count) =>
        editSmartctl(stored, (json) => setErrorLogCount(json, count)),
      ),
    };
  },
});

export const DISK_ERROR_LOG_SCENARIOS: Scenario<"disk">[] = [errorLogGrowth];

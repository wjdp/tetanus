import { defineScenario, type Scenario } from "../types";
import { editPlan, type Json, smartctlSatisfies } from "./disk";

const FARM_LOG_KEY = "seagate_farm_log";

type Section = Record<string, unknown>;

const farmLogOf = (json: Json) => json[FARM_LOG_KEY] as Section | undefined;

function sectionOf(farmLog: Section, name: string) {
  const section = farmLog[name];
  return section && typeof section === "object" ? (section as Section) : {};
}

export function tripHelium(json: Json) {
  const farmLog = farmLogOf(json);
  if (!farmLog) throw new Error("No FARM log stored for this disk");
  if ("page_1_drive_information" in farmLog) {
    const reliability = sectionOf(farmLog, "page_5_reliability_statistics");
    reliability.helium_presure_trip = 1;
    farmLog.page_5_reliability_statistics = reliability;
  } else {
    const reliability = sectionOf(farmLog, "reliability_statistics");
    reliability.helium_pressure_threshold_tripped = 1;
    farmLog.reliability_statistics = reliability;
  }
}

export const heliumTripped = defineScenario({
  id: "helium-tripped",
  label: "Helium pressure tripped",
  group: "Health",
  subjectType: "disk",
  description:
    "The drive's FARM log reports its helium pressure threshold as tripped.",
  applies: (subject) =>
    smartctlSatisfies(subject, (json) => farmLogOf(json) !== undefined),
  plan: (subject) => editPlan(subject, tripHelium),
});

export const DISK_HELIUM_SCENARIOS: Scenario<"disk">[] = [heliumTripped];

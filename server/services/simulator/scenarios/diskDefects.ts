import { defineScenario, type Scenario } from "../types";
import { editPlan, type Json, smartctlSatisfies } from "./disk";

const REPORTED_UNCORRECTABLE_ATTRIBUTE = 187;
const REPORTED_UNCORRECTABLE_PAGE = 4;
const REPORTED_UNCORRECTABLE_OFFSET = 8;
const SIMULATED_REPORTED_UNCORRECTABLE = 12;

interface StatisticEntry {
  offset: number;
  value?: number;
}

interface StatisticPage {
  number: number;
  table?: StatisticEntry[];
}

function reportedUncorrectableEntry(json: Json) {
  const pages = (json.ata_device_statistics as { pages?: StatisticPage[] })
    ?.pages;
  return pages
    ?.find((page) => page.number === REPORTED_UNCORRECTABLE_PAGE)
    ?.table?.find((entry) => entry.offset === REPORTED_UNCORRECTABLE_OFFSET);
}

function hasAttribute(json: Json, attrId: number) {
  const table = (json.ata_smart_attributes as { table?: { id: number }[] })
    ?.table;
  return table?.some((row) => row.id === attrId) ?? false;
}

export function raiseReportedUncorrectableStatistic(json: Json) {
  const entry = reportedUncorrectableEntry(json);
  if (!entry) throw new Error("No reported uncorrectable device statistic");
  entry.value = SIMULATED_REPORTED_UNCORRECTABLE;
}

export const statisticsUncorrectable = defineScenario({
  id: "statistics-uncorrectable",
  label: "Reported uncorrectable (device statistics)",
  group: "Health",
  subjectType: "disk",
  description:
    "The drive's device statistics report uncorrectable errors on a drive without attribute 187.",
  applies: (subject) =>
    smartctlSatisfies(
      subject,
      (json) =>
        reportedUncorrectableEntry(json) !== undefined &&
        !hasAttribute(json, REPORTED_UNCORRECTABLE_ATTRIBUTE),
    ),
  plan: (subject) => editPlan(subject, raiseReportedUncorrectableStatistic),
});

export const DISK_DEFECT_SCENARIOS: Scenario<"disk">[] = [
  statisticsUncorrectable,
];

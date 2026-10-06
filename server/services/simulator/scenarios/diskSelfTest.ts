import { hasSelfTestLog, protocolOf } from "../smartctl";
import { defineScenario, type Scenario } from "../types";
import { editPlan, smartctlSatisfies } from "./disk";

type Json = Record<string, unknown>;

function loggedHours(rows: unknown[], hoursOf: (row: Json) => unknown) {
  return rows
    .map((row) => hoursOf(row as Json))
    .filter((hours): hours is number => typeof hours === "number");
}

function nextHours(json: Json, logged: number[]) {
  const powerOn = (json.power_on_time as Json | undefined)?.hours;
  return Math.max(typeof powerOn === "number" ? powerOn : 0, ...logged, 0) + 1;
}

function addPassedAtaLongTest(json: Json) {
  const log = (json.ata_smart_self_test_log ?? {}) as Json;
  json.ata_smart_self_test_log = log;
  const key = log.extended || !log.standard ? "extended" : "standard";
  const section = (log[key] ?? { revision: 1 }) as Json;
  log[key] = section;
  const table = Array.isArray(section.table) ? section.table : [];
  section.table = [
    {
      type: { value: 2, string: "Extended offline" },
      status: { value: 0, string: "Completed without error", passed: true },
      lifetime_hours: nextHours(
        json,
        loggedHours(table, (row) => row.lifetime_hours),
      ),
    },
    ...table,
  ];
  section.count = (Number(section.count) || 0) + 1;
}

function addPassedNvmeLongTest(json: Json) {
  const log = (json.nvme_self_test_log ?? {}) as Json;
  json.nvme_self_test_log = log;
  const table = Array.isArray(log.table) ? log.table : [];
  log.table = [
    {
      self_test_code: { value: 2, string: "Extended" },
      self_test_result: { value: 0, string: "Completed without error" },
      power_on_hours: nextHours(
        json,
        loggedHours(table, (row) => row.power_on_hours),
      ),
    },
    ...table,
  ];
}

export const selfTestPassed = defineScenario({
  id: "self-test-passed",
  label: "Long self-test passed",
  group: "Health",
  subjectType: "disk",
  description:
    "A new extended self-test completes without error, which resolves an earlier failed short or extended test.",
  applies: (subject) => smartctlSatisfies(subject, hasSelfTestLog),
  plan: (subject) =>
    editPlan(subject, (json) => {
      if (protocolOf(json) === "NVMe") addPassedNvmeLongTest(json);
      else addPassedAtaLongTest(json);
    }),
});

export const DISK_SELF_TEST_SCENARIOS: Scenario<"disk">[] = [selfTestPassed];

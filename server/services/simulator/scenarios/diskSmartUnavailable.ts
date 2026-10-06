import { editSmartctl, withExitBits } from "../smartctl";
import { smartctlPayloadOf } from "../subjects";
import { defineScenario, type Scenario, type SubjectOf } from "../types";
import { type Json, replayPlan, requireSmartctl } from "./disk";

const COMMAND_FAILED = 4;

const SMART_DATA_PREFIXES = [
  "ata_smart",
  "ata_sct",
  "ata_device_statistics",
  "nvme_smart_health_information_log",
  "nvme_error_information_log",
  "nvme_self_test_log",
  "scsi_",
];

function stripSmartData(json: Json) {
  for (const key of Object.keys(json)) {
    if (SMART_DATA_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      delete json[key];
    }
  }
  delete json.smart_status;
  delete json.power_on_time;
  delete json.power_cycle_count;
  delete json.temperature;
}

const withoutSmartData = (
  subject: SubjectOf<"disk">,
  edit: (json: Json) => void,
) =>
  editSmartctl(requireSmartctl(subject), (json) => {
    stripSmartData(json);
    edit(json);
  });

const hasSmartctl = (subject: SubjectOf<"disk">) =>
  smartctlPayloadOf(subject) !== undefined;

export const smartUnsupported = defineScenario({
  id: "smart-unsupported",
  label: "SMART not supported",
  group: "Health",
  subjectType: "disk",
  description:
    "The drive reports identity but says it does not support SMART, so there is nothing to monitor.",
  applies: hasSmartctl,
  plan: (subject) =>
    replayPlan(
      withoutSmartData(subject, (json) => {
        json.smart_support = { available: false };
      }),
    ),
});

export const smartDisabled = defineScenario({
  id: "smart-disabled",
  label: "SMART disabled",
  group: "Health",
  subjectType: "disk",
  description:
    "The drive supports SMART but has it turned off, so it returns no attributes.",
  applies: hasSmartctl,
  plan: (subject) =>
    replayPlan(
      withoutSmartData(subject, (json) => {
        json.smart_support = { available: true, enabled: false };
      }),
    ),
});

export const smartUnreadable = defineScenario({
  id: "smart-unreadable",
  label: "SMART unreadable",
  group: "Health",
  subjectType: "disk",
  description:
    "smartctl reads the drive's identity but its SMART commands fail, as behind a USB bridge without passthrough.",
  applies: hasSmartctl,
  plan: (subject) =>
    replayPlan(
      withExitBits(
        withoutSmartData(subject, (json) => {
          delete json.smart_support;
        }),
        COMMAND_FAILED,
      ),
    ),
});

export const DISK_SMART_UNAVAILABLE_SCENARIOS: Scenario<"disk">[] = [
  smartUnsupported,
  smartDisabled,
  smartUnreadable,
];

import { ataAttribute, editSmartctl, setAtaRaw } from "../smartctl";
import { defineScenario, type Scenario } from "../types";
import {
  requireSmartctl,
  requireSmartctlJson,
  smartctlSatisfies,
} from "./disk";

const CRC_ERROR_ATTRIBUTE = 199;

export const crcErrorsRising = defineScenario({
  id: "crc-errors-rising",
  label: "CRC errors rising",
  group: "SMART attributes",
  subjectType: "disk",
  description:
    "UDMA_CRC_Error_Count rises across several readings in a row, as a loose cable or failing backplane would cause. Three rises within 7 days open an interface errors fault.",
  applies: (subject) =>
    smartctlSatisfies(
      subject,
      (json) => ataAttribute(json, CRC_ERROR_ATTRIBUTE) !== undefined,
    ),
  params: () => [
    {
      key: "readings",
      label: "Readings",
      kind: "number",
      default: 3,
      min: 1,
      max: 12,
    },
    {
      key: "step",
      label: "Errors per reading",
      kind: "number",
      default: 4,
      min: 1,
    },
  ],
  plan: (subject, params) => {
    const stored = requireSmartctl(subject);
    const current = Number(
      ataAttribute(requireSmartctlJson(subject), CRC_ERROR_ATTRIBUTE)?.raw
        ?.value ?? 0,
    );
    const step = Number(params.step);
    return {
      replays: Array.from({ length: Number(params.readings) }, (_, index) =>
        editSmartctl(stored, (json) =>
          setAtaRaw(json, CRC_ERROR_ATTRIBUTE, current + step * (index + 1)),
        ),
      ),
    };
  },
});

export const DISK_INTERFACE_SCENARIOS: Scenario<"disk">[] = [crcErrorsRising];

export const SIMULATION_SUBJECT_TYPES = ["disk", "pool", "host"] as const;
export type SimulationSubjectType = (typeof SIMULATION_SUBJECT_TYPES)[number];

export type SimulationParamValue = string | number;
export type SimulationParams = Record<string, SimulationParamValue>;

export interface ScenarioParamOption {
  value: string;
  label: string;
}

export type ScenarioParam =
  | {
      key: string;
      label: string;
      kind: "number";
      default: number;
      min?: number;
      max?: number;
      unit?: string;
    }
  | {
      key: string;
      label: string;
      kind: "select";
      default: string;
      options: ScenarioParamOption[];
    };

export interface ScenarioView {
  id: string;
  label: string;
  group: string;
  description?: string;
  params: ScenarioParam[];
}

export interface SimulationView {
  id: number;
  scenario: string;
  label: string;
  subjectType: SimulationSubjectType;
  subjectId: number;
  createdAt: string;
}

export interface SimulatorStatus {
  simulations: SimulationView[];
}

export interface SubjectScenarios extends SimulatorStatus {
  scenarios: ScenarioView[];
}

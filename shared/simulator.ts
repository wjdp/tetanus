export const SIMULATION_SUBJECT_TYPES = ["disk", "pool", "host"] as const;
export type SimulationSubjectType = (typeof SIMULATION_SUBJECT_TYPES)[number];

export type SimulationParamValue = string | number;
export type SimulationParams = Record<string, SimulationParamValue>;

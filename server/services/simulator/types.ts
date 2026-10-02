import type { ScenarioParam, SimulationParams } from "#shared/simulator";
import type { disk, host, pool } from "~~/server/database/schema";
import type { StoredPayload } from "./payloads";

export type HostRow = typeof host.$inferSelect;

export type Subject =
  | { type: "disk"; disk: typeof disk.$inferSelect; host: HostRow }
  | { type: "pool"; pool: typeof pool.$inferSelect; host: HostRow }
  | { type: "host"; host: HostRow };

export type SubjectOf<T extends Subject["type"]> = Extract<
  Subject,
  { type: T }
>;

export interface SimulationPlan {
  /** Edited copies of stored payloads, replayed through ingest in order at the simulation instant. */
  replays: StoredPayload[];
  /** Direct writes after the replays, for state no payload carries (backdated sightings). */
  afterReplay?: (now: Date) => void;
}

export interface Scenario<T extends Subject["type"] = Subject["type"]> {
  id: string;
  label: string;
  group: string;
  subjectType: T;
  description?: string;
  applies?: (subject: SubjectOf<T>) => boolean;
  params?: (subject: SubjectOf<T>) => ScenarioParam[];
  plan: (
    subject: SubjectOf<T>,
    params: SimulationParams,
    now: Date,
  ) => SimulationPlan;
}

export const defineScenario = <T extends Subject["type"]>(
  scenario: Scenario<T>,
) => scenario;

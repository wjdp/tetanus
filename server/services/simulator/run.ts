import { asc } from "drizzle-orm";
import type {
  ScenarioView,
  SimulationParams,
  SimulationSubjectType,
  SimulatorStatus,
  SubjectScenarios,
} from "#shared/simulator";
import { db } from "~~/server/database/client";
import { simulation } from "~~/server/database/schema";
import { runAlertsPass } from "~~/server/services/alerts/dispatch";
import { notifyFaultsChanged } from "~~/server/services/faults";
import { recordIngest } from "~~/server/services/ingest";
import { invalidRequest } from "~~/server/utils/serviceError";
import { rollBackCapture, startCapture } from "./capture";
import { SCENARIOS } from "./scenarios";
import { loadSubject } from "./subjects";
import type { Scenario, Subject } from "./types";

export function simulatorStatus(): SimulatorStatus {
  const labels = new Map(
    SCENARIOS.map((scenario) => [scenario.id, scenario.label]),
  );
  return {
    simulations: db
      .select()
      .from(simulation)
      .orderBy(asc(simulation.id))
      .all()
      .map((row) => ({
        id: row.id,
        scenario: row.scenario,
        label: labels.get(row.scenario) ?? row.scenario,
        subjectType: row.subjectType,
        subjectId: row.subjectId,
        createdAt: row.createdAt.toISOString(),
      })),
  };
}

function applicable(subject: Subject): Scenario[] {
  return SCENARIOS.filter(
    (scenario) =>
      scenario.subjectType === subject.type &&
      (scenario.applies?.(subject as never) ?? true),
  );
}

function view(scenario: Scenario, subject: Subject): ScenarioView {
  return {
    id: scenario.id,
    label: scenario.label,
    group: scenario.group,
    description: scenario.description,
    params: scenario.params?.(subject as never) ?? [],
  };
}

export function subjectScenarios(
  subjectType: SimulationSubjectType,
  subjectId: number,
): SubjectScenarios {
  const subject = loadSubject(subjectType, subjectId);
  return {
    ...simulatorStatus(),
    scenarios: subject
      ? applicable(subject).map((scenario) => view(scenario, subject))
      : [],
  };
}

function resolveParams(
  scenario: Scenario,
  subject: Subject,
  given: SimulationParams,
): SimulationParams {
  const resolved: SimulationParams = {};
  for (const param of scenario.params?.(subject as never) ?? []) {
    const value = given[param.key] ?? param.default;
    if (param.kind === "number") {
      const number = Number(value);
      if (
        !Number.isFinite(number) ||
        (param.min !== undefined && number < param.min) ||
        (param.max !== undefined && number > param.max)
      ) {
        throw invalidRequest(`${param.label} is out of range`);
      }
      resolved[param.key] = number;
    } else {
      if (!param.options.some((option) => option.value === String(value))) {
        throw invalidRequest(`${param.label} is not one of the options`);
      }
      resolved[param.key] = String(value);
    }
  }
  return resolved;
}

export async function simulate(
  subjectType: SimulationSubjectType,
  subjectId: number,
  scenarioId: string,
  given: SimulationParams,
  now = new Date(),
): Promise<SimulatorStatus> {
  const subject = loadSubject(subjectType, subjectId);
  if (!subject) throw invalidRequest("No host collects this subject");
  const scenario = applicable(subject).find((each) => each.id === scenarioId);
  if (!scenario) {
    throw invalidRequest(`Scenario ${scenarioId} does not apply here`);
  }
  const params = resolveParams(scenario, subject, given);
  const plan = scenario.plan(subject as never, params, now);

  startCapture();
  db.insert(simulation)
    .values({
      scenario: scenario.id,
      subjectType,
      subjectId,
      params,
      createdAt: now,
    })
    .run();
  for (const replay of plan.replays) {
    const outcome = recordIngest({
      hostName: replay.hostName ?? subject.host.name,
      source: replay.source,
      meta: replay.meta,
      body: replay.body,
      producer: replay.producer,
      receivedAt: now,
    });
    if (!outcome.ok && !outcome.reported) {
      throw new Error(`Simulated ${replay.source} failed: ${outcome.error}`);
    }
  }
  plan.afterReplay?.(now);
  await runAlertsPass(now);
  notifyFaultsChanged();
  return simulatorStatus();
}

export function restore(): SimulatorStatus {
  rollBackCapture();
  notifyFaultsChanged();
  return simulatorStatus();
}

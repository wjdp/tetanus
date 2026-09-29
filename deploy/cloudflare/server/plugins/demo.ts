import { db } from "~~/server/database/client";
import { host } from "~~/server/database/schema";
import {
  finishSeed,
  holdAlertsQueue,
  type SeedProgress,
  type SeedReport,
  seedSteps,
  tick,
} from "~~/server/demo/seed";
import { ensureSettings } from "~~/server/services/settings";
import { applySmartPolicyIfStale } from "~~/server/services/smartPolicy";
import { publishOperations, type SeedStep } from "../../bridge";

interface RunningSeed {
  startedAt: number;
  steps: AsyncGenerator<SeedProgress, SeedReport, void>;
  restoreAlertsQueue: () => Promise<void>;
  progress: SeedProgress | null;
}

let running: RunningSeed | undefined;

function hasHosts() {
  return db.select({ id: host.id }).from(host).limit(1).get() !== undefined;
}

async function abandonRunningSeed() {
  const abandoned = running;
  running = undefined;
  await abandoned?.restoreAlertsQueue();
}

async function runningSeed(startedAt: Date): Promise<RunningSeed> {
  if (running?.startedAt === startedAt.getTime()) return running;
  await abandonRunningSeed();
  running = {
    startedAt: startedAt.getTime(),
    steps: seedSteps(startedAt),
    restoreAlertsQueue: await holdAlertsQueue(),
    progress: null,
  };
  return running;
}

async function finish(seed: RunningSeed, replay: SeedReport) {
  const report = await finishSeed(new Date(seed.startedAt), replay);
  await abandonRunningSeed();
  console.log(
    `Demo seeded: ${report.instants} instants, ${report.notifications} notifications, ${report.failures.length} failures`,
  );
  for (const failure of report.failures) console.warn(failure);
  await tick(new Date());
}

async function advance(seed: RunningSeed): Promise<SeedStep> {
  const step = await seed.steps.next();
  if (step.done) {
    await finish(seed, step.value);
    const total = seed.progress?.total ?? 0;
    return { done: total, total, finished: true };
  }
  seed.progress = step.value;
  return { done: step.value.done, total: step.value.total, finished: false };
}

export default defineNitroPlugin(() => {
  publishOperations({
    async prepare(now) {
      ensureSettings();
      applySmartPolicyIfStale(now);
      return { seeded: hasHosts() };
    },
    async seedStep(startedAt) {
      const seed = await runningSeed(startedAt);
      try {
        return await advance(seed);
      } catch (error) {
        await abandonRunningSeed();
        throw error;
      }
    },
    async tick(now) {
      await tick(now);
    },
  });
});

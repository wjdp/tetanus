import { DurableObject } from "cloudflare:workers";
import { APP_NAME } from "../../shared/app";
import { bindStorage, demoOperations, type SeedStep } from "./bridge";
import { prepareSchema } from "./migrate";

interface Env {
  DEMO: DurableObjectNamespace<TetanusDemo>;
  WRITES: RateLimit;
}

interface NitroHandler {
  fetch(
    request: Request,
    env: Env,
    context: Pick<ExecutionContext, "waitUntil">,
  ): Promise<Response>;
}

const TICK_CRON = "0 * * * *";
const RESET_CRON = "15 4 * * *";
const WRITE_METHODS = new Set(["PATCH", "POST", "DELETE"]);
const SEED_KEY = "seed";
const SEED_INSTANTS_PER_ALARM = 40;
const SEED_INSTANTS_PER_YIELD = 5;
const SEED_ATTEMPTS = 3;
const RETRY_AFTER_SECONDS = 10;

interface SeedFlag {
  startedAt: number;
  attempt: number;
}

let nitroHandler: Promise<NitroHandler> | undefined;

function loadNitroHandler() {
  nitroHandler ??= import("../../.output/server/index.mjs").then(
    (module) => module.default as NitroHandler,
  );
  return nitroHandler;
}

const RESETTING_PAGE = `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="${RETRY_AFTER_SECONDS}">
<title>Resetting › ${APP_NAME}</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: system-ui, sans-serif; background: Canvas; color: CanvasText; }
  main { padding: 1rem; text-align: center; }
  h1 { font-size: 1.25rem; margin: 0 0 0.5rem; }
  p { margin: 0; opacity: 0.7; }
</style>
</head>
<body>
<main>
<h1>${APP_NAME}</h1>
<p>Demo is resetting, back in about a minute.</p>
</main>
</body>
</html>
`;

// Seeding is synchronous SQL; a timer turn every few instants lets waiting
// requests in for their 503 instead of queueing behind the whole alarm. Each
// turn also commits the implicit transaction, so not after every instant.
function yieldToRequests() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function resettingResponse(request: Request) {
  const headers = { "Retry-After": String(RETRY_AFTER_SECONDS) };
  const { pathname } = new URL(request.url);
  if (pathname.startsWith("/api/")) {
    return Response.json(
      { error: "Demo is resetting" },
      { status: 503, headers },
    );
  }
  if (pathname === "/health") {
    return Response.json(
      { ok: false, seeding: true, checks: { database: true } },
      { status: 503, headers },
    );
  }
  return new Response(RESETTING_PAGE, {
    status: 503,
    headers: { ...headers, "Content-Type": "text/html; charset=utf-8" },
  });
}

export class TetanusDemo extends DurableObject<Env> {
  private seeding: SeedFlag | undefined;
  private alarmInFlight: Promise<void> | undefined;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(() => this.start());
  }

  // A seed flag left over means the previous seed never finished: start again
  // from an empty database rather than resume a half-written replay.
  private async start() {
    const storage = this.ctx.storage;
    bindStorage(storage);
    const interrupted = await storage.get<SeedFlag>(SEED_KEY);
    if (interrupted) await storage.deleteAll();
    await prepareSchema(storage);
    await loadNitroHandler();
    this.seeding = undefined;
    const { seeded } = await demoOperations().prepare(new Date());
    if (seeded) return;
    const attempt = (interrupted?.attempt ?? 0) + 1;
    if (attempt > SEED_ATTEMPTS) {
      console.error(`Demo seed abandoned after ${SEED_ATTEMPTS} attempts`);
      return;
    }
    this.seeding = { startedAt: Date.now(), attempt };
    await storage.put(SEED_KEY, this.seeding);
    await storage.setAlarm(Date.now());
  }

  async fetch(request: Request) {
    if (this.seeding) return resettingResponse(request);
    const handler = await loadNitroHandler();
    return handler.fetch(request, this.env, this.ctx);
  }

  async alarm() {
    this.alarmInFlight = this.continueSeed();
    try {
      await this.alarmInFlight;
    } finally {
      this.alarmInFlight = undefined;
    }
  }

  private async continueSeed() {
    const seed = this.seeding;
    if (!seed) return;
    const chunkStartedAt = Date.now();
    try {
      const chunk = await this.seedChunk(seed);
      const now = Date.now();
      console.log(
        `Demo seed ${chunk.done}/${chunk.total} instants, chunk ${now - chunkStartedAt} ms, total ${now - seed.startedAt} ms`,
      );
      if (this.seeding !== seed) return;
      if (chunk.finished) {
        await this.ctx.storage.delete(SEED_KEY);
        this.seeding = undefined;
      } else {
        await this.ctx.storage.setAlarm(Date.now());
      }
    } catch (error) {
      console.error("Demo seed failed; starting again", error);
      if (this.seeding === seed) {
        await this.ctx.blockConcurrencyWhile(() => this.start());
      }
    }
  }

  private async seedChunk(seed: SeedFlag): Promise<SeedStep> {
    const startedAt = new Date(seed.startedAt);
    let step = await demoOperations().seedStep(startedAt);
    for (let taken = 1; taken < SEED_INSTANTS_PER_ALARM; taken++) {
      if (step.finished) break;
      if (taken % SEED_INSTANTS_PER_YIELD === 0) await yieldToRequests();
      step = await demoOperations().seedStep(startedAt);
    }
    return step;
  }

  async tick() {
    if (this.seeding) return;
    await demoOperations().tick(new Date());
  }

  async reset() {
    await this.alarmInFlight;
    await this.ctx.blockConcurrencyWhile(async () => {
      await this.ctx.storage.deleteAll();
      await this.start();
    });
  }
}

function demo(env: Env) {
  return env.DEMO.get(env.DEMO.idFromName("demo"));
}

function isApiWrite(request: Request) {
  return (
    WRITE_METHODS.has(request.method) &&
    new URL(request.url).pathname.startsWith("/api/")
  );
}

async function writeAllowed(request: Request, env: Env) {
  const key = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const { success } = await env.WRITES.limit({ key });
  return success;
}

export default {
  async fetch(request, env) {
    if (isApiWrite(request) && !(await writeAllowed(request, env))) {
      return Response.json(
        { error: "Too many writes; try again in a minute" },
        { status: 429 },
      );
    }
    return demo(env).fetch(request);
  },

  async scheduled(controller, env) {
    if (controller.cron === RESET_CRON) await demo(env).reset();
    else if (controller.cron === TICK_CRON) await demo(env).tick();
  },
} satisfies ExportedHandler<Env>;

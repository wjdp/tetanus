import { DurableObject } from "cloudflare:workers";
import { bindStorage, demoOperations } from "./bridge";
import { migrateStorage } from "./migrate";

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

let nitroHandler: Promise<NitroHandler> | undefined;

function loadNitroHandler() {
  nitroHandler ??= import("../../.output/server/index.mjs").then(
    (module) => module.default as NitroHandler,
  );
  return nitroHandler;
}

export class TetanusDemo extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(() => this.start());
  }

  private async start() {
    bindStorage(this.ctx.storage);
    await migrateStorage(this.ctx.storage);
    await loadNitroHandler();
    await demoOperations().bootstrap(new Date());
  }

  async fetch(request: Request) {
    const handler = await loadNitroHandler();
    return handler.fetch(request, this.env, this.ctx);
  }

  async tick() {
    await demoOperations().tick(new Date());
  }

  async reset() {
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

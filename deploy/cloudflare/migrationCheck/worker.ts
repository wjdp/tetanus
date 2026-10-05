import { DurableObject } from "cloudflare:workers";
import { migrateStorage } from "../migrate";

interface Env {
  CHECK: DurableObjectNamespace<MigrationCheck>;
}

export class MigrationCheck extends DurableObject<Env> {
  async fetch() {
    try {
      const report = await migrateStorage(this.ctx.storage);
      return Response.json(report);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return Response.json({ error: message }, { status: 500 });
    }
  }
}

export default {
  fetch(request, env) {
    return env.CHECK.get(env.CHECK.idFromName("check")).fetch(request);
  },
} satisfies ExportedHandler<Env>;

import { DurableObject } from "cloudflare:workers";
import { prepareSchema } from "../migrate";

interface Env {
  CHECK: DurableObjectNamespace<SchemaCheck>;
}

export class SchemaCheck extends DurableObject<Env> {
  async fetch() {
    try {
      const first = await prepareSchema(this.ctx.storage);
      const second = await prepareSchema(this.ctx.storage);
      const tables = this.ctx.storage.sql
        .exec<{ name: string }>(
          `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'`,
        )
        .toArray()
        .map((row) => row.name);
      return Response.json({
        rebuilt: first.rebuilt,
        rebuiltAgain: second.rebuilt,
        tables,
      });
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

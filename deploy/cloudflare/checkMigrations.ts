import { createTestHarness } from "wrangler";

// Node's SQLite accepts statements Durable Object SQLite refuses (temp
// objects, some pragmas), so apply the bundled migrations in workerd itself.
const server = createTestHarness({
  workers: [
    { configPath: new URL("migrationCheck/wrangler.jsonc", import.meta.url) },
  ],
});

try {
  await server.listen();
  const response = await server.fetch("/");
  const body = (await response.json()) as
    | { applied: string[]; total: number; durationMs: number }
    | { error: string };
  if ("error" in body) {
    console.error(`Migrations failed in workerd: ${body.error}`);
    process.exitCode = 1;
  } else if (body.applied.length !== body.total) {
    console.error(
      `Applied ${body.applied.length} of ${body.total} migrations in workerd`,
    );
    process.exitCode = 1;
  } else {
    console.log(
      `Applied ${body.total} migrations in workerd in ${body.durationMs} ms`,
    );
  }
} finally {
  await server.close();
}

import { createTestHarness } from "wrangler";

// Node's SQLite accepts statements Durable Object SQLite refuses (temp
// objects, some pragmas), so build the demo schema in workerd itself.
const server = createTestHarness({
  workers: [
    { configPath: new URL("schemaCheck/wrangler.jsonc", import.meta.url) },
  ],
});

function fail(message: string) {
  console.error(message);
  process.exitCode = 1;
}

try {
  await server.listen();
  const response = await server.fetch("/");
  const body = (await response.json()) as
    | { rebuilt: boolean; rebuiltAgain: boolean; tables: string[] }
    | { error: string };
  if ("error" in body) fail(`Demo schema failed in workerd: ${body.error}`);
  else if (!body.rebuilt) fail("Demo schema was not built on an empty object");
  else if (body.rebuiltAgain) fail("Demo schema rebuilt despite no change");
  else if (body.tables.length === 0) fail("Demo schema created no tables");
  else
    console.log(`Built demo schema in workerd: ${body.tables.length} tables`);
} finally {
  await server.close();
}

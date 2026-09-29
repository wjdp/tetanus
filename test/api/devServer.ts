import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The Nitro server runs in its own process, so route tests hand it a file
// database rather than the in-memory one the unit tests share.
export function createTestDatabaseFile() {
  return join(mkdtempSync(join(tmpdir(), "tetanus-e2e-")), "e2e.sqlite");
}

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on("error", reject);
    probe.listen(0, () => {
      const address = probe.address();
      if (typeof address === "string" || address === null) {
        reject(new Error("Could not determine a free port"));
        return;
      }
      probe.close(() => resolve(address.port));
    });
  });
}

async function waitForServer(host: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${host}/health`);
      if (response.ok) return;
    } catch {
      // server not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Nuxt dev server did not start within ${timeoutMs}ms`);
}

export async function startNuxtServer(
  databaseFile: string,
  extraEnv: Record<string, string> = {},
) {
  const port = await findFreePort();
  const child = spawn(
    process.execPath,
    ["node_modules/nuxt/bin/nuxt.mjs", "dev", "--port", String(port)],
    {
      cwd: process.cwd(),
      detached: true,
      stdio: "ignore",
      env: {
        ...process.env,
        DATABASE_URL: `file:${databaseFile}`,
        // `nuxt dev` refuses to boot under NODE_ENV=test, which vitest sets.
        NODE_ENV: "development",
        NUXT_TELEMETRY_DISABLED: "1",
        NUXT_IGNORE_LOCK: "1",
        ...extraEnv,
      },
    },
  );
  const host = `http://localhost:${port}`;
  try {
    await waitForServer(host, 180_000);
  } catch (error) {
    if (child.pid) process.kill(-child.pid, "SIGKILL");
    throw error;
  }
  return {
    host,
    stop: () => {
      if (child.pid) process.kill(-child.pid, "SIGKILL");
    },
  };
}

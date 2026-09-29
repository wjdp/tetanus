import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { RawManifestEntry } from "~~/server/services/diagnostics";
import { recordIngest } from "~~/server/services/ingest";

interface RawManifest {
  host: string;
  manifest: RawManifestEntry[];
}

function readManifest(hostDirectory: string): RawManifest {
  return JSON.parse(
    readFileSync(join(hostDirectory, "manifest.json"), "utf8"),
  ) as RawManifest;
}

// Ingests each host's raw collector output from a diagnostics bundle in the
// order it was exported, which is the order the collector posts in.
export function replayBundle(bundleDirectory: string) {
  const rawDirectory = join(bundleDirectory, "raw");
  for (const hostEntry of readdirSync(rawDirectory, { withFileTypes: true })) {
    if (!hostEntry.isDirectory()) continue;
    const hostDirectory = join(rawDirectory, hostEntry.name);
    const { host, manifest } = readManifest(hostDirectory);
    for (const entry of manifest) {
      const outcome = recordIngest({
        hostName: host,
        source: entry.source,
        meta: {
          device: entry.device ?? undefined,
          type: entry.type ?? undefined,
          exitStatus: entry.exitStatus ?? undefined,
        },
        body: readFileSync(join(hostDirectory, entry.file), "utf8"),
        receivedAt: new Date(entry.receivedAt),
      });
      if (!outcome.ok) {
        throw new Error(`Replay of ${entry.file} failed: ${outcome.error}`);
      }
    }
  }
}

import type { ReplicationEndpoint, ReplicationRow } from "#shared/replications";

export const NOW = Date.parse("2026-09-28T12:00:00.000Z");
const HOUR_MS = 60 * 60_000;
export const hoursAgo = (hours: number) =>
  new Date(NOW - hours * HOUR_MS).toISOString();

let nextDatasetId = 100;

export const endpoint = (
  hostName: string,
  datasetName: string,
  overrides: { hostId?: number; datasetId?: number; present?: boolean } = {},
): ReplicationEndpoint => ({
  host: { id: overrides.hostId ?? 1, name: hostName, displayName: null },
  pool: { id: 7, name: datasetName.split("/")[0] ?? datasetName },
  dataset: {
    id: overrides.datasetId ?? nextDatasetId++,
    name: datasetName,
    present: overrides.present ?? true,
  },
});

export const replicationRow = (
  id: number,
  overrides: Partial<ReplicationRow> = {},
): ReplicationRow => ({
  id,
  source: endpoint("atlas", "tank/media"),
  target: endpoint("styx", "vault/replica/tank/media", { hostId: 2 }),
  direction: "received",
  status: "ok",
  intervalSec: 3600,
  intervalManual: false,
  lastSyncAt: hoursAgo(0.5),
  dueAt: hoursAgo(-0.5),
  overdueMs: -30 * 60_000,
  syncCount: 40,
  archivedAt: null,
  archivedNote: "",
  ...overrides,
});

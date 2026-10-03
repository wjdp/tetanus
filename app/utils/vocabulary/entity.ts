export const ENTITIES = [
  "host",
  "pool",
  "disk",
  "dataset",
  "replication",
  "snapshot",
  "diary",
  "fault",
  "alert-channel",
  "topology",
] as const;
export type Entity = (typeof ENTITIES)[number];

export const ENTITY_ICON: Record<Entity, string> = {
  host: "i-lucide-server",
  pool: "i-lucide-database",
  disk: "i-lucide-hard-drive",
  dataset: "i-lucide-folder-tree",
  replication: "i-lucide-arrow-right-left",
  snapshot: "i-lucide-camera",
  diary: "i-lucide-notebook-pen",
  fault: "i-lucide-siren",
  "alert-channel": "i-lucide-bell",
  topology: "i-lucide-network",
};

import type { ReplicationPatch } from "#shared/schemas/replications";

export const patchReplication = (id: number, body: ReplicationPatch) =>
  $fetch(`/api/replications/${id}`, { method: "PATCH", body });

import type { FaultKind, FaultSeverity } from "#shared/faults";

export type ZfsMessage =
  | { title: string; severity: FaultSeverity }
  | { title: string; coveredBy: FaultKind };

// The OpenZFS message catalogue (https://openzfs.github.io/openzfs-docs/msg/),
// as `zpool status` reports it in `msgid`. Codes whose condition another fault
// kind already raises from the pool or vdev state are `coveredBy` it.
export const ZFS_MESSAGES: Record<string, ZfsMessage> = {
  "ZFS-8000-14": { title: "Corrupt ZFS cache", severity: "warning" },
  "ZFS-8000-2Q": {
    title: "Missing device in replicated configuration",
    coveredBy: "pool-degraded",
  },
  "ZFS-8000-3C": {
    title: "Missing device in non-replicated configuration",
    coveredBy: "pool-degraded",
  },
  "ZFS-8000-4J": {
    title: "Corrupted device label in a replicated configuration",
    coveredBy: "pool-degraded",
  },
  "ZFS-8000-5E": {
    title: "Corrupted device label in non-replicated configuration",
    coveredBy: "pool-degraded",
  },
  "ZFS-8000-6X": {
    title: "Missing top level device",
    coveredBy: "pool-degraded",
  },
  "ZFS-8000-72": {
    title: "Corrupted pool metadata",
    coveredBy: "pool-degraded",
  },
  "ZFS-8000-8A": { title: "Corrupted data", coveredBy: "pool-data-errors" },
  "ZFS-8000-9P": {
    title: "Failing device in replicated configuration",
    coveredBy: "leaf-errors",
  },
  "ZFS-8000-A5": { title: "Incompatible version", severity: "error" },
  "ZFS-8000-ER": { title: "ZFS errata", severity: "warning" },
  "ZFS-8000-EY": { title: "ZFS label hostid mismatch", severity: "warning" },
  "ZFS-8000-HC": { title: "ZFS pool I/O failures", coveredBy: "pool-degraded" },
  "ZFS-8000-JQ": { title: "ZFS pool I/O failures", coveredBy: "pool-degraded" },
  "ZFS-8000-MM": {
    title: "ZFS pool suspended by multihost",
    coveredBy: "pool-degraded",
  },
  "ZFS-8000-K4": { title: "ZFS intent log read failure", severity: "error" },
};

export function zfsMessage(msgid: string): ZfsMessage | undefined {
  return Object.hasOwn(ZFS_MESSAGES, msgid) ? ZFS_MESSAGES[msgid] : undefined;
}

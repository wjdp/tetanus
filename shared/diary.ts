export const DIARY_SUBJECT_TYPES = [
  "disk",
  "pool",
  "vdev",
  "dataset",
  "host",
  "system",
] as const;
export type DiarySubjectType = (typeof DIARY_SUBJECT_TYPES)[number];

export const DIARY_ENTRY_KINDS = ["manual", "auto"] as const;
export type DiaryEntryKind = (typeof DIARY_ENTRY_KINDS)[number];

export const DIARY_EVENT_TYPES = [
  "state-changed",
  "override-set",
  "smart-status-changed",
  "attribute-status-changed",
  "fault-accepted",
  "acceptance-superseded",
  "acceptance-cleared",
  "disk-appeared",
  "moved-host",
  "pool-moved",
  "vdev-joined",
  "vdev-left",
  "vdev-state-changed",
  "pool-state-changed",
  "scrub-finished",
  "resilver-finished",
  "scan-finished",
  "alias-set",
  "alias-drift",
  "identity-conflict",
  "usage-changed",
  "dataset-created",
  "dataset-destroyed",
  "collector-status-changed",
  "events-gap",
  "events-reset",
  "imported-from-scrutiny",
  "fault-dismissed",
  "fault-restored",
] as const;
export type DiaryEventType = (typeof DIARY_EVENT_TYPES)[number];

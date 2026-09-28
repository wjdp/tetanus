export const DIARY_SUBJECT_TYPES = [
  "disk",
  "pool",
  "vdev",
  "host",
  "system",
] as const;
export type DiarySubjectType = (typeof DIARY_SUBJECT_TYPES)[number];

export const DIARY_ENTRY_KINDS = ["manual", "auto"] as const;
export type DiaryEntryKind = (typeof DIARY_ENTRY_KINDS)[number];

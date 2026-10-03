import type { DiaryEntry } from "./types";

const twoDigits = (value: number) => String(value).padStart(2, "0");

export function localToday(now = new Date()): string {
  return `${now.getFullYear()}-${twoDigits(now.getMonth() + 1)}-${twoDigits(now.getDate())}`;
}

type DiaryMoment = Pick<DiaryEntry, "eventType" | "at">;

const latestOf = <Entry extends DiaryMoment>(
  entries: Entry[],
  eventType: string,
): Entry | undefined =>
  entries
    .filter((entry) => entry.eventType === eventType)
    .reduce<Entry | undefined>(
      (latest, entry) =>
        latest && Date.parse(String(latest.at)) >= Date.parse(String(entry.at))
          ? latest
          : entry,
      undefined,
    );

export function seenSinceDisposal<Entry extends DiaryMoment>(
  diary: Entry[],
): Entry | null {
  const seen = latestOf(diary, "disposed-disk-seen");
  if (!seen) return null;
  const disposed = latestOf(diary, "disposed");
  if (
    disposed &&
    Date.parse(String(disposed.at)) >= Date.parse(String(seen.at))
  )
    return null;
  return seen;
}

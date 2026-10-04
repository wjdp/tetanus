import type {
  ReplicationDirection,
  ReplicationRole,
  ReplicationStatus,
} from "#shared/replications";
import type { StatusColour } from "./colour";
import type { DotShape } from "./deviceStatus";

export interface ReplicationStatusVocabulary {
  colour: StatusColour;
  shape: DotShape;
  label: string;
  rank: number;
}

export const REPLICATION_STATUS_VOCABULARY: Record<
  ReplicationStatus,
  ReplicationStatusVocabulary
> = {
  "target-gone": {
    colour: "error",
    shape: "filled",
    label: "Target gone",
    rank: 6,
  },
  stalled: { colour: "error", shape: "filled", label: "Stalled", rank: 5 },
  late: { colour: "warning", shape: "filled", label: "Late", rank: 4 },
  "source-gone": {
    colour: "neutral",
    shape: "hollow",
    label: "Source gone",
    rank: 3,
  },
  learning: { colour: "neutral", shape: "hollow", label: "Learning", rank: 2 },
  ok: { colour: "neutral", shape: "filled", label: "OK", rank: 1 },
  archived: { colour: "neutral", shape: "hollow", label: "Archived", rank: 0 },
};

export function worstReplicationStatus(
  statuses: readonly ReplicationStatus[],
): ReplicationStatus {
  return statuses.reduce<ReplicationStatus>(
    (worst, status) =>
      REPLICATION_STATUS_VOCABULARY[status].rank >
      REPLICATION_STATUS_VOCABULARY[worst].rank
        ? status
        : worst,
    "archived",
  );
}

export const REPLICATION_ROLE_VOCABULARY: Record<
  ReplicationRole,
  { icon: string; label: string }
> = {
  source: { icon: "i-lucide-upload", label: "Sends" },
  target: { icon: "i-lucide-download", label: "Receives" },
};

export const REPLICATION_DIRECTION_LABEL: Record<ReplicationDirection, string> =
  {
    received: "Discovered",
    manual: "Source set by hand",
  };

const MINUTE_SEC = 60;
const HOUR_SEC = 60 * MINUTE_SEC;
const DAY_SEC = 24 * HOUR_SEC;

const NAMED_CADENCES = [
  { seconds: HOUR_SEC, word: "hourly" },
  { seconds: DAY_SEC, word: "daily" },
  { seconds: 7 * DAY_SEC, word: "weekly" },
] as const;

const EXACT_TOLERANCE = 0.02;
const NEAR_TOLERANCE = 0.15;

const deviation = (value: number, reference: number) =>
  Math.abs(value - reference) / reference;

function cadenceUnit(seconds: number) {
  if (seconds < 2 * HOUR_SEC) return { seconds: MINUTE_SEC, suffix: "min" };
  if (seconds < 2 * DAY_SEC) return { seconds: HOUR_SEC, suffix: "h" };
  return { seconds: DAY_SEC, suffix: "d" };
}

/**
 * "hourly", "~daily", "every 6 h". A learnt interval within 2 % of a named
 * cadence takes its word, within 15 % the word with "~". A manual interval is
 * exact: named only when it matches, "~" whenever rounding changed it.
 */
export function formatCadence(
  intervalSec: number | null,
  manual = false,
): string {
  if (intervalSec === null) return "learning";
  for (const { seconds, word } of NAMED_CADENCES) {
    const off = deviation(intervalSec, seconds);
    if (manual ? off === 0 : off <= EXACT_TOLERANCE) return word;
    if (!manual && off <= NEAR_TOLERANCE) return `~${word}`;
  }
  const unit = cadenceUnit(intervalSec);
  const value = intervalSec / unit.seconds;
  const rounded = Math.max(1, Math.round(value));
  const approximate =
    deviation(rounded, value) > (manual ? 0 : EXACT_TOLERANCE);
  return `every ${approximate ? "~" : ""}${rounded} ${unit.suffix}`;
}

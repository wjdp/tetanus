<script setup lang="ts">
import type { PoolLastScrub } from "#shared/schemas/pools";
import {
  isLastScrubCurrentScan,
  isScanActive,
  isScrubOverdue,
  lastScrubAt,
  type PoolScan,
  scanDurationMs,
  scanEndedAt,
  scanPausedAt,
  scanProgress,
  scanStalledSince,
  scanStartedAt,
  scanStateLabel,
} from "./scan";
import { formatTimestamp } from "./timestamp";

const props = defineProps<{
  scan: PoolScan | null;
  lastScrub: PoolLastScrub | null;
  scanProgressAt: string | Date | null;
  firstSeenAt: string | Date;
  scrubIntervalDays: number;
  now: number;
}>();

const progress = computed(() =>
  props.scan && isScanActive(props.scan)
    ? scanProgress(props.scan, props.now)
    : null,
);
const pausedAt = computed(() => (props.scan ? scanPausedAt(props.scan) : null));
const stalledSince = computed(() =>
  props.scan
    ? scanStalledSince(props.scan, props.scanProgressAt, props.now)
    : null,
);
const duration = computed(() =>
  props.scan ? scanDurationMs(props.scan, props.now) : null,
);
const previousScrub = computed(() =>
  props.lastScrub && !isLastScrubCurrentScan(props.scan, props.lastScrub)
    ? props.lastScrub
    : null,
);
const overdue = computed(() =>
  isScrubOverdue(
    {
      scan: props.scan,
      lastScrub: props.lastScrub,
      firstSeenAt: props.firstSeenAt,
      intervalDays: props.scrubIntervalDays,
    },
    props.now,
  ),
);
const lastScrubbed = computed(() => lastScrubAt(props.scan, props.lastScrub));

const { formatZfsBytes } = useZfsByteSystem();
</script>

<template>
  <section
    class="border-default flex flex-col gap-3 rounded-lg border p-4"
    data-testid="scan-panel"
  >
    <h2 class="text-highlighted font-semibold">Scan</h2>
    <p v-if="!scan" class="text-dimmed text-sm">No scan recorded.</p>
    <template v-else>
      <div v-if="progress" class="flex flex-col gap-1">
        <UProgress :model-value="progress.percent" color="info" size="sm" />
        <p class="text-info tabular text-sm" data-testid="scan-progress">
          {{ progress.verb }} {{ progress.percent }} %<template
            v-if="pausedAt"
          >
            · paused since {{ formatTimestamp(pausedAt) }}</template
          ><template v-else-if="stalledSince">
            · no progress since {{ formatTimestamp(stalledSince) }}</template
          ><template v-else-if="progress.msLeft !== null">
            · {{ formatDuration(progress.msLeft) }} left</template
          >
        </p>
      </div>
      <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt class="text-muted">Function</dt>
        <dd class="text-highlighted">{{ scan.function.toLowerCase() }}</dd>
        <dt class="text-muted">State</dt>
        <dd class="text-highlighted" data-testid="scan-state">
          {{ scanStateLabel(scan) }}
        </dd>
        <dt class="text-muted">Started</dt>
        <dd class="tabular">{{ formatTimestamp(scanStartedAt(scan)) }}</dd>
        <dt class="text-muted">Ended</dt>
        <dd class="tabular">{{ formatTimestamp(scanEndedAt(scan)) }}</dd>
        <template v-if="duration !== null">
          <dt class="text-muted">Duration</dt>
          <dd class="tabular">{{ formatDuration(duration) }}</dd>
        </template>
        <dt class="text-muted">Examined</dt>
        <dd class="tabular">
          {{ formatZfsBytes(scan.examined) }} of {{ formatZfsBytes(scan.toExamine) }}
        </dd>
        <template v-if="scan.processed !== undefined">
          <dt class="text-muted">Repaired</dt>
          <dd class="tabular" data-testid="scan-repaired">
            {{ formatZfsBytes(scan.processed) }}
          </dd>
        </template>
        <dt class="text-muted">Errors</dt>
        <dd
          class="tabular"
          :class="scan.errors > 0 ? 'text-error' : 'text-highlighted'"
          data-testid="scan-errors"
        >
          {{ scan.errors }}
        </dd>
      </dl>
    </template>
    <p
      v-if="previousScrub"
      class="tabular text-sm"
      :class="previousScrub.errors > 0 ? 'text-error' : 'text-muted'"
      data-testid="last-scrub"
    >
      Last scrub {{ formatTimestamp(previousScrub.endAt) }} ·
      {{ previousScrub.errors }} errors<template
        v-if="previousScrub.repairedBytes"
      >
        · repaired {{ formatZfsBytes(previousScrub.repairedBytes) }}</template
      >
      · took {{ formatDuration(previousScrub.durationS * 1000) }}
    </p>
    <p v-if="overdue" class="text-warning text-sm" data-testid="scrub-overdue">
      Scrub overdue:
      {{
        lastScrubbed === null
          ? "never scrubbed"
          : `last scrubbed ${formatDuration(now - lastScrubbed)} ago`
      }},
      interval {{ scrubIntervalDays }} d
    </p>
  </section>
</template>

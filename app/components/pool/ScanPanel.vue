<script setup lang="ts">
import {
  isScanActive,
  type PoolScan,
  scanEndedAt,
  scanProgress,
  scanStartedAt,
} from "./scan";
import { formatTimestamp } from "./timestamp";

const props = defineProps<{ scan: PoolScan | null; now: number }>();

const progress = computed(() =>
  props.scan && isScanActive(props.scan)
    ? scanProgress(props.scan, props.now)
    : null,
);
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
        <p class="text-info tabular text-sm">
          {{ progress.verb }} {{ progress.percent }} %<template
            v-if="progress.msLeft !== null"
          >
            · {{ formatDuration(progress.msLeft) }} left</template
          >
        </p>
      </div>
      <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt class="text-muted">Function</dt>
        <dd class="text-highlighted">{{ scan.function.toLowerCase() }}</dd>
        <dt class="text-muted">State</dt>
        <dd class="text-highlighted">{{ scan.state.toLowerCase() }}</dd>
        <dt class="text-muted">Started</dt>
        <dd class="tabular">{{ formatTimestamp(scanStartedAt(scan)) }}</dd>
        <dt class="text-muted">Ended</dt>
        <dd class="tabular">{{ formatTimestamp(scanEndedAt(scan)) }}</dd>
        <dt class="text-muted">Examined</dt>
        <dd class="tabular">
          {{ formatBytes(scan.examined) }} of {{ formatBytes(scan.toExamine) }}
        </dd>
        <dt class="text-muted">Errors</dt>
        <dd
          class="tabular"
          :class="scan.errors > 0 ? 'text-warning' : 'text-highlighted'"
        >
          {{ scan.errors }}
        </dd>
      </dl>
    </template>
  </section>
</template>

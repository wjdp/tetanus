<script setup lang="ts">
import { formatTimestamp } from "./timestamp";
import type { PoolRemoval } from "./types";

const props = defineProps<{ removal: PoolRemoval }>();

const isCopying = computed(() => props.removal.state === "SCANNING");
const percent = computed(() =>
  props.removal.toCopy > 0
    ? Math.min(
        100,
        Math.floor((props.removal.copied / props.removal.toCopy) * 100),
      )
    : 0,
);
const stateLabel = computed(() =>
  isCopying.value
    ? "copying"
    : props.removal.state === "CANCELED"
      ? "cancelled"
      : props.removal.state.toLowerCase(),
);
</script>

<template>
  <section
    class="border-default flex flex-col gap-3 rounded-lg border p-4"
    data-testid="removal-panel"
  >
    <h2 class="text-highlighted font-semibold">Device removal</h2>
    <div v-if="isCopying" class="flex flex-col gap-1">
      <UProgress :model-value="percent" color="info" size="sm" />
      <p class="text-info tabular text-sm">removing {{ percent }} %</p>
    </div>
    <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
      <dt class="text-muted">Vdev</dt>
      <dd class="text-highlighted tabular">{{ removal.removingVdev }}</dd>
      <dt class="text-muted">State</dt>
      <dd class="text-highlighted">{{ stateLabel }}</dd>
      <dt class="text-muted">Started</dt>
      <dd class="tabular">
        {{ formatTimestamp(new Date(removal.startTime * 1000)) }}
      </dd>
      <dt class="text-muted">Completed</dt>
      <dd class="tabular">
        {{
          formatTimestamp(
            removal.endTime ? new Date(removal.endTime * 1000) : null,
          )
        }}
      </dd>
      <dt class="text-muted">Copied</dt>
      <dd class="tabular">
        {{ formatBytes(removal.copied) }} of {{ formatBytes(removal.toCopy) }}
      </dd>
      <dt class="text-muted">Mapping memory</dt>
      <dd class="tabular">{{ formatBytes(removal.mappingMemory) }}</dd>
    </dl>
  </section>
</template>

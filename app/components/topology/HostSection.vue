<script setup lang="ts">
import type { RunLike } from "~/utils/hostFreshness";
import { isScanActive, scanProgress } from "../pool/scan";
import type { TopologyPool } from "./groupDisks";

const props = defineProps<{
  host: {
    id: number;
    name: string;
    displayName: string | null;
    lastRuns: Record<string, RunLike>;
  };
  pools: TopologyPool[];
  now: number;
}>();

const cadences = useRuntimeConfig().public.demo ? DEMO_CADENCES : undefined;

const relativeTime = (date: Date | null) =>
  date ? `${formatDuration(props.now - date.getTime())} ago` : "never";

const chipColor = (
  status: ReturnType<typeof allGroupFreshness>[number]["status"],
) => (status === "ok" ? "neutral" : status);

const activeScans = computed(() =>
  props.pools.flatMap((pool) => {
    if (!pool.scan || !isScanActive(pool.scan)) return [];
    const progress = scanProgress(pool.scan, props.now);
    const left =
      progress.msLeft === null
        ? ""
        : ` · ${formatDuration(progress.msLeft)} left`;
    return [
      {
        pool: pool.name,
        text: `${progress.verb} ${progress.percent} %${left}`,
      },
    ];
  }),
);
</script>

<template>
  <section class="flex flex-col gap-4" data-testid="host-section">
    <header class="flex flex-wrap items-center gap-x-4 gap-y-2">
      <h2 class="text-highlighted text-lg font-semibold">
        {{ host.displayName || host.name }}
        <span
          v-if="host.displayName"
          class="text-dimmed ml-1 font-mono text-sm font-normal"
        >
          {{ host.name }}
        </span>
      </h2>
      <div class="flex flex-wrap gap-1">
        <UBadge
          v-for="group in allGroupFreshness(host.lastRuns, now, cadences)"
          :key="group.name"
          :color="chipColor(group.status)"
          variant="subtle"
          size="sm"
        >
          {{ group.name }}: {{ relativeTime(group.lastSeenAt) }}
        </UBadge>
      </div>
      <UBadge
        v-for="scan in activeScans"
        :key="scan.pool"
        color="info"
        variant="subtle"
        size="sm"
        icon="i-lucide-loader"
      >
        {{ scan.pool }}: {{ scan.text }}
      </UBadge>
    </header>

    <p v-if="pools.length === 0" class="text-muted text-sm">
      No pools reported yet.
    </p>

    <TopologyPoolCard
      v-for="pool in pools"
      :key="pool.id"
      :pool="pool"
      :now="now"
    />
  </section>
</template>

<script setup lang="ts">
import { statisticPanes } from "./statisticsRows";
import type { DiskStatisticsView } from "./types";

const props = defineProps<{ diskId: number }>();

const { data: statistics } = await useFetch<DiskStatisticsView>(
  () => `/api/disks/${props.diskId}/statistics`,
);

const panes = computed(() =>
  statistics.value ? statisticPanes(statistics.value) : [],
);
</script>

<template>
  <section class="flex flex-col gap-3" data-testid="statistics">
    <p v-if="!panes.length" class="text-muted text-sm">
      No device statistics yet. They arrive with the next reading from a drive
      that keeps them.
    </p>
    <template v-else>
      <p class="text-dimmed text-xs">
        Lifetime figures the drive keeps itself, from its latest reading
      </p>
      <div class="grid gap-4 md:grid-cols-2">
        <DiskFactGroup
          v-for="pane in panes"
          :key="pane.id"
          :title="pane.title"
          :data-pane="pane.id"
        >
          <DiskFact
            v-for="fact in pane.facts"
            :key="fact.label"
            :label="fact.label"
            :class="fact.warning ? 'text-warning' : undefined"
            :data-fact="fact.label"
          >
            {{ fact.value }}
            <span v-if="fact.note" class="text-dimmed text-xs">· {{ fact.note }}</span>
          </DiskFact>
          <template v-if="pane.clear.length" #footer>
            <p class="text-dimmed text-xs" data-testid="pane-clear">
              None: {{ pane.clear.join(", ").toLowerCase() }}
            </p>
          </template>
        </DiskFactGroup>
      </div>
    </template>
  </section>
</template>

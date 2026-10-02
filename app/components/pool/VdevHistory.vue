<script setup lang="ts">
import type { TimeSeries } from "../charts/alignSeries";
import type { VdevReading } from "./types";

const props = defineProps<{ poolId: number; vdevId: number }>();

const { data, status } = useLazyFetch<{ readings: VdevReading[] }>(
  `/api/pools/${props.poolId}/vdevs/${props.vdevId}/readings`,
  { server: false },
);

const readings = computed(() => data.value?.readings ?? []);

const series = computed<TimeSeries[]>(() => [
  {
    label: "Errors (R + W + C)",
    points: readings.value.map((reading) => ({
      at: reading.at,
      value:
        reading.readErrors + reading.writeErrors + reading.checksumErrors,
    })),
  },
  {
    label: "Slow I/Os",
    points: readings.value.flatMap((reading) =>
      reading.slowIos === null ? [] : [{ at: reading.at, value: reading.slowIos }],
    ),
  },
]);
</script>

<template>
  <div class="py-2" data-testid="vdev-history">
    <p v-if="status === 'error'" class="text-error text-sm">
      Could not load the history.
    </p>
    <p v-else-if="status === 'pending'" class="text-dimmed text-sm">
      Loading history…
    </p>
    <p v-else-if="readings.length === 0" class="text-dimmed text-sm">
      No readings in the last 30 days.
    </p>
    <ChartsTimeSeriesChart v-else :series="series" :height="140" />
  </div>
</template>

<script setup lang="ts">
import { getPageTitle } from "#shared/app";
import { lastSegment } from "~/components/dataset/treeRows";
import { formatTimestamp } from "~/components/pool/timestamp";

const route = useRoute();
const {
  data: dataset,
  error,
  refresh,
} = await useFetch(`/api/datasets/${route.params.id}`);

if (error.value) {
  throw createError({
    statusCode: error.value.statusCode ?? 500,
    statusMessage: error.value.statusMessage,
  });
}

useSeoMeta({ title: getPageTitle(dataset.value?.name ?? "Dataset") });

const shortName = computed(() =>
  dataset.value ? lastSegment(dataset.value.name) : "Dataset",
);

const usedSeries = computed(() => {
  const readings = dataset.value?.readings ?? [];
  const { unit, divisor } = byteUnitFor(
    Math.max(0, ...readings.map((reading) => reading.used)),
  );
  return {
    unit,
    series: [
      {
        label: "Used",
        points: readings.map((reading) => ({
          at: reading.at,
          value: Number((reading.used / divisor).toFixed(2)),
        })),
      },
    ],
  };
});

const formatRatio = (ratio: number | null) =>
  ratio === null ? "—" : `${ratio.toFixed(2)}×`;

const properties = computed(() => {
  const row = dataset.value;
  if (!row) return [];
  return [
    { label: "Used", value: formatBytes(row.used) },
    { label: "Referenced", value: formatBytes(row.referenced) },
    { label: "Available", value: formatBytes(row.available) },
    { label: "Logical used", value: formatBytes(row.logicalUsed) },
    { label: "Ratio", value: formatRatio(row.compressRatio) },
    { label: "Used by snapshots", value: formatBytes(row.usedBySnapshots) },
    { label: "Used by dataset", value: formatBytes(row.usedByDataset) },
    { label: "Used by children", value: formatBytes(row.usedByChildren) },
    { label: "Quota", value: formatBytes(row.quota) },
    { label: "Refquota", value: formatBytes(row.refQuota) },
    { label: "Reservation", value: formatBytes(row.reservation) },
    { label: "Recordsize", value: formatBytes(row.recordSize) },
    { label: "Compression", value: row.compression ?? "—" },
    { label: "Encryption", value: row.encryption ?? "—" },
    { label: "Created", value: formatTimestamp(row.creation) },
  ];
});
</script>

<template>
  <AppPanel :title="shortName" class="max-w-7xl">
    <div v-if="dataset" class="flex flex-col gap-6">
      <header class="flex flex-col gap-2">
        <div class="flex flex-wrap items-center gap-3">
          <h1 class="text-highlighted text-2xl font-semibold tracking-tight">
            {{ shortName }}
          </h1>
          <UBadge
            :color="dataset.type === 'volume' ? 'info' : 'neutral'"
            variant="subtle"
          >
            {{ dataset.type }}
          </UBadge>
          <UBadge v-if="!dataset.present" color="warning" variant="subtle">
            destroyed
          </UBadge>
          <NuxtLink
            :to="`/zfs/${dataset.pool.id}`"
            class="text-muted hover:text-primary"
          >
            {{ dataset.host.displayName || dataset.host.name }} ·
            {{ dataset.pool.name }}
          </NuxtLink>
        </div>
        <p class="text-dimmed font-mono text-sm">{{ dataset.name }}</p>
        <p v-if="dataset.mountpoint" class="text-muted text-sm">
          Mounted at
          <span class="text-toned font-mono">{{ dataset.mountpoint }}</span>
        </p>
      </header>

      <div
        class="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]"
      >
        <section
          class="border-default flex flex-col gap-3 rounded-lg border p-4"
          data-testid="properties-panel"
        >
          <h2 class="text-highlighted font-semibold">Properties</h2>
          <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <template v-for="property in properties" :key="property.label">
              <dt class="text-muted">{{ property.label }}</dt>
              <dd class="text-highlighted tabular">{{ property.value }}</dd>
            </template>
          </dl>
          <div v-if="dataset.children.length" class="flex flex-col gap-1">
            <h3 class="text-muted text-sm">Children</h3>
            <ul class="flex flex-wrap gap-x-3 gap-y-1 text-sm">
              <li v-for="child in dataset.children" :key="child.id">
                <NuxtLink
                  :to="`/datasets/${child.id}`"
                  :title="child.name"
                  class="font-mono hover:underline"
                  :class="child.present ? 'text-highlighted' : 'text-dimmed'"
                >
                  {{ lastSegment(child.name) }}
                </NuxtLink>
              </li>
            </ul>
          </div>
        </section>

        <section
          class="border-default flex flex-col gap-3 rounded-lg border p-4"
          data-testid="used-panel"
        >
          <h2 class="text-highlighted font-semibold">Used</h2>
          <p
            v-if="dataset.readings.length < 2"
            class="text-dimmed py-4 text-sm"
          >
            Not enough readings for a chart yet: one is kept per day.
          </p>
          <ChartsTimeSeriesChart
            v-else
            :series="usedSeries.series"
            :unit="usedSeries.unit"
          />
        </section>
      </div>

      <section class="flex flex-col gap-3">
        <h2 class="text-highlighted text-lg font-semibold">
          Snapshots
          <span class="text-muted tabular text-sm font-normal">
            {{ dataset.snapshots.length }}
          </span>
        </h2>
        <DatasetSnapshotTable :snapshots="dataset.snapshots" />
      </section>

      <section class="flex flex-col gap-3">
        <h2 class="text-highlighted text-lg font-semibold">Diary</h2>
        <DiaryTimeline
          :entries="dataset.diary"
          :show-subject="false"
          empty="Nothing in the diary for this dataset yet."
          @changed="refresh"
        />
      </section>
    </div>
  </AppPanel>
</template>

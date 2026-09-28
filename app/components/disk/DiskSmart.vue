<script setup lang="ts">
import type { DiskProtocol } from "#shared/disk";
import {
  SMART_HISTORY_RANGES,
  type SmartHistoryRange,
} from "#shared/schemas/smart";
import { countByStatus, defaultAttributeId } from "./attributeOrder";
import type { SmartOverview } from "./types";

const props = defineProps<{
  diskId: number;
  protocol: DiskProtocol | null;
}>();

const range = ref<SmartHistoryRange>("30d");
const rangeItems = SMART_HISTORY_RANGES.map((value) => ({
  label: value,
  value,
}));

const { data: smart, status } = await useFetch<SmartOverview>(
  () => `/api/disks/${props.diskId}/smart`,
  { query: { range } },
);

const attributes = computed(() => smart.value?.attributes ?? []);
const counts = computed(() => countByStatus(attributes.value));
const deviceStatus = computed(() => smart.value?.reading?.deviceStatus ?? "unknown");

const reasonSummary = computed(() =>
  [
    counts.value.failed && `${counts.value.failed} failed`,
    counts.value.warning && `${counts.value.warning} warning`,
  ]
    .filter(Boolean)
    .join(", "),
);

const selectedAttribute = ref<string | null>(null);
watch(
  attributes,
  (current) => {
    const stillPresent = current.some(
      (attribute) => attribute.attrId === selectedAttribute.value,
    );
    if (!stillPresent) {
      selectedAttribute.value = defaultAttributeId(current, props.protocol);
    }
  },
  { immediate: true },
);

const selectedMeta = computed(() =>
  attributes.value.find((attribute) => attribute.attrId === selectedAttribute.value),
);

const temperatureSeries = computed(() => [
  {
    label: "Temperature",
    points: (smart.value?.history.temperature ?? []).map((point) => ({
      at: point.at,
      value: point.celsius,
    })),
  },
]);

const attributeSeries = computed(() => {
  const attribute = selectedMeta.value;
  if (!attribute) return [];
  return [
    {
      label: attribute.metadata?.displayName ?? attribute.name,
      points: smart.value?.history.attributes[attribute.attrId] ?? [],
    },
  ];
});
</script>

<template>
  <section class="flex flex-col gap-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h2 class="text-highlighted text-lg font-semibold">SMART</h2>
      <UTabs
        v-model="range"
        :items="rangeItems"
        :content="false"
        size="xs"
        color="neutral"
        variant="pill"
      />
    </div>

    <p v-if="!smart?.reading" class="text-muted text-sm">
      No SMART readings yet.
    </p>

    <template v-else>
      <div class="flex flex-wrap items-center gap-2 text-sm">
        <UBadge
          :color="deviceStatusColour(deviceStatus)"
          variant="subtle"
          :label="deviceStatus"
        />
        <span v-if="reasonSummary" class="text-default">
          {{ reasonSummary }} {{ counts.failed + counts.warning === 1 ? "attribute" : "attributes" }}
        </span>
        <span class="text-dimmed">
          read {{ formatDate(smart.reading.takenAt) }} from
          <span class="font-mono text-xs">{{ smart.reading.devicePath }}</span>
        </span>
        <UIcon
          v-if="status === 'pending'"
          name="i-lucide-loader-circle"
          class="text-dimmed animate-spin"
        />
      </div>

      <div class="flex flex-col gap-2">
        <h3 class="text-muted text-sm font-medium">Temperature</h3>
        <ChartsTimeSeriesChart :series="temperatureSeries" unit="°C" :height="160" />
      </div>

      <DiskAttributeTable
        v-model:selected="selectedAttribute"
        :attributes="attributes"
        :history="smart.history.attributes"
        :show-normalised="protocol === 'ata'"
      />

      <div v-if="selectedMeta" class="flex flex-col gap-2">
        <h3 class="text-muted text-sm font-medium">
          {{ selectedMeta.metadata?.displayName ?? selectedMeta.name }}
          <span class="text-dimmed font-mono text-xs">{{ selectedMeta.attrId }}</span>
        </h3>
        <ChartsTimeSeriesChart
          :series="attributeSeries"
          :unit="selectedMeta.metadata?.transformValueUnit"
          :height="160"
        />
      </div>
    </template>
  </section>
</template>

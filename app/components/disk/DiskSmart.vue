<script setup lang="ts">
import type { DiskProtocol } from "#shared/disk";
import {
  SMART_HISTORY_RANGES,
  type SmartHistoryRange,
} from "#shared/schemas/smart";
import { DEVICE_STATUS_VOCABULARY } from "~/utils/vocabulary";
import { countByStatus } from "./attributeRows";
import type { LatestAttribute, SmartOverview } from "./types";

const props = defineProps<{
  diskId: number;
  protocol: DiskProtocol | null;
}>();

const emit = defineEmits<{ changed: [] }>();

const range = ref<SmartHistoryRange>("30d");
const rangeItems = SMART_HISTORY_RANGES.map((value) => ({
  label: value,
  value,
}));

const {
  data: smart,
  status,
  refresh,
} = await useFetch<SmartOverview>(
  () => `/api/disks/${props.diskId}/smart`,
  { query: { range } },
);

const attributes = computed(() => smart.value?.attributes ?? []);
const counts = computed(() => countByStatus(attributes.value));
const deviceStatus = computed(() => smart.value?.reading?.deviceStatus ?? "unknown");

const statusBadgeColour = computed(() =>
  deviceStatus.value === "passed"
    ? "neutral"
    : DEVICE_STATUS_VOCABULARY[deviceStatus.value].colour,
);

const faultCount = computed(() => counts.value.failed + counts.value.warning);

const reasonSummary = computed(() =>
  [
    counts.value.failed && `${counts.value.failed} failed`,
    counts.value.warning && `${counts.value.warning} warning`,
  ]
    .filter(Boolean)
    .join(", "),
);

const toast = useToast();
const accepting = ref<LatestAttribute | null>(null);
const acceptOpen = ref(false);
const clearing = ref<LatestAttribute | null>(null);
const clearOpen = ref(false);

const attributeLabel = (attribute: LatestAttribute | null) =>
  attribute ? (attribute.metadata?.displayName ?? attribute.name) : "";

const onAccept = (attribute: LatestAttribute) => {
  accepting.value = attribute;
  acceptOpen.value = true;
};

const onClear = (attribute: LatestAttribute) => {
  clearing.value = attribute;
  clearOpen.value = true;
};

const refreshAfterChange = async () => {
  await refresh();
  emit("changed");
};

const clearAcceptance = async () => {
  const attribute = clearing.value;
  if (!attribute) return;
  try {
    await $fetch(
      `/api/disks/${props.diskId}/accept/${encodeURIComponent(attribute.attrId)}`,
      { method: "DELETE" },
    );
    toast.add({ title: `Cleared ${attributeLabel(attribute)}`, color: "neutral" });
  } catch {
    toast.add({ title: "Could not clear the acceptance", color: "error" });
  }
  await refreshAfterChange();
};

const temperatureSeries = computed(() => [
  {
    label: "Temperature",
    points: (smart.value?.history.temperature ?? []).map((point) => ({
      at: point.at,
      value: point.celsius,
    })),
  },
]);
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
          :color="statusBadgeColour"
          variant="subtle"
          :label="deviceStatus"
          data-testid="smart-status"
        />
        <span v-if="reasonSummary" class="text-default">
          {{ reasonSummary }} {{ faultCount === 1 ? "attribute" : "attributes" }}
        </span>
        <span v-if="counts.accepted" class="text-muted">
          · {{ counts.accepted }} accepted
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

      <p
        v-if="smart.history.importedUntil"
        class="text-dimmed text-sm"
        data-testid="imported-note"
      >
        Readings before {{ formatDate(smart.history.importedUntil) }} were
        imported from scrutiny at daily resolution
      </p>

      <div class="flex flex-col gap-2">
        <h3 class="text-muted text-sm font-medium">Temperature</h3>
        <ChartsTimeSeriesChart :series="temperatureSeries" unit="°C" :height="160" />
      </div>

      <DiskAttributeTable
        :attributes="attributes"
        :history="smart.history.attributes"
        :acceptances="smart.acceptances"
        :show-normalised="protocol === 'ata'"
        @accept="onAccept"
        @clear="onClear"
      />

      <DiskSelfTests :self-tests="smart.selfTests" />
    </template>

    <DiskAcceptFaultModal
      v-model:open="acceptOpen"
      :disk-id="diskId"
      :attribute="accepting"
      @accepted="refreshAfterChange"
    />

    <ConfirmModal
      v-model:open="clearOpen"
      :title="`Clear acceptance of ${attributeLabel(clearing)}?`"
      description="The attribute counts towards the disk status again."
      confirm-label="Clear"
      :action="clearAcceptance"
    />
  </section>
</template>

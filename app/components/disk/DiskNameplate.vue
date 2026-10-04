<script setup lang="ts">
import { interfaceLabel, sectorFormat } from "#shared/hardware";
import { displayModel } from "#shared/model";
import { temperatureColour } from "#shared/temperature";
import { DEVICE_STATUS_VOCABULARY, STATUS_TEXT_CLASS } from "~/utils/vocabulary";
import { displayName } from "./displayName";
import type { DiskDetail } from "./types";

const props = withDefaults(
  defineProps<{ disk: DiskDetail; replacesLabel?: string | null }>(),
  { replacesLabel: null },
);
defineEmits<{ updated: [disk: DiskDetail] }>();

const name = computed(() => displayName(props.disk));

const interfaceText = computed(() =>
  interfaceDetail(
    interfaceLabel(props.disk.interface, props.disk.link),
    props.disk.hardware,
  ),
);

const smartStatus = computed(
  () => DEVICE_STATUS_VOCABULARY[props.disk.latestStatus],
);

const temperatureClass = computed(() => {
  const colour = temperatureColour(
    props.disk.latestTemp,
    props.disk.tempThresholds,
  );
  return colour === "neutral" ? undefined : STATUS_TEXT_CLASS[colour];
});

const linkSpeed = computed(() => linkSpeedDisplay(props.disk.hardware));

const facts = computed(() => [
  { label: "Capacity", value: formatBytes(props.disk.capacityBytes) },
  { label: "Firmware", value: props.disk.firmware ?? "—", mono: true },
  { label: "Interface", value: interfaceText.value ?? "—", linkSpeed: linkSpeed.value },
  { label: "Media", value: mediaSummary(props.disk) ?? "—" },
  {
    label: "Sectors",
    value:
      sectorFormat(props.disk.logicalBlockSize, props.disk.physicalBlockSize) ??
      "—",
  },
  { label: "Device", value: props.disk.lastDevicePath ?? "—", mono: true },
  { label: "First seen", value: formatDate(props.disk.firstSeenAt) },
  { label: "Last seen", value: formatDate(props.disk.lastSeenAt) },
  { label: "Power-on", value: formatHours(props.disk.latestPowerOnHours) },
  {
    label: "Power cycles",
    value: props.disk.latestPowerCycles?.toLocaleString("en-GB") ?? "—",
  },
  {
    label: "Temperature",
    value: formatCelsius(props.disk.latestTemp),
    class: temperatureClass.value,
    testId: "nameplate-temperature",
  },
]);
</script>

<template>
  <section class="flex flex-col gap-4">
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div class="flex min-w-0 flex-col gap-1">
        <h1
          class="text-2xl font-semibold tracking-tight"
          :class="name ? 'text-highlighted' : 'text-dimmed italic'"
        >
          {{ name ?? "unnamed" }}
        </h1>
        <p class="text-muted flex items-center gap-1.5 text-sm">
          <MediaGlyph :media="disk.media" :size="20" class="text-muted" />
          {{ displayModel(disk.model, disk.vendor) ?? "Unknown model" }}
          <span v-if="disk.serial" class="text-default font-mono">
            · {{ disk.serial }}
          </span>
        </p>
        <p
          v-if="disk.replacesDiskId"
          class="text-muted flex items-center gap-1.5 text-sm"
          data-testid="nameplate-replaces"
        >
          <UIcon name="i-lucide-replace" class="size-4" />
          Replaces
          <NuxtLink
            :to="`/disks/${disk.replacesDiskId}`"
            class="text-default hover:text-primary font-medium"
          >
            {{ replacesLabel ?? `disk ${disk.replacesDiskId}` }}
          </NuxtLink>
        </p>
      </div>
      <div class="flex flex-col items-end gap-2">
        <UBadge
          color="neutral"
          variant="outline"
          :label="smartStatus.label"
          data-testid="nameplate-smart-status"
        >
          <template #leading>
            <TopologyStatusDot
              :colour="smartStatus.colour"
              :shape="smartStatus.shape"
            />
          </template>
        </UBadge>
        <DiskStateControl :disk="disk" @updated="$emit('updated', $event)" />
      </div>
    </div>

    <dl class="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3 lg:grid-cols-5">
      <div class="flex flex-col">
        <dt class="text-dimmed text-xs">Host</dt>
        <dd>
          <ULink
            v-if="disk.hostName && disk.lastSeenHostId !== null"
            :to="`/hosts/${disk.lastSeenHostId}`"
            class="text-default hover:text-primary"
          >
            {{ disk.hostName }}
          </ULink>
          <span v-else>—</span>
        </dd>
      </div>
      <div v-for="fact in facts" :key="fact.label" class="flex flex-col">
        <dt class="text-dimmed text-xs">{{ fact.label }}</dt>
        <dd
          class="tabular truncate"
          :class="[fact.class, { 'font-mono text-xs leading-5': fact.mono }]"
          :data-testid="fact.testId"
        >
          {{ fact.value }}
          <template v-if="fact.linkSpeed">
            ·
            <span
              :class="{ 'text-error': fact.linkSpeed.belowMax }"
              :title="fact.linkSpeed.title"
            >
              {{ fact.linkSpeed.text }}
            </span>
          </template>
        </dd>
      </div>
    </dl>
  </section>
</template>

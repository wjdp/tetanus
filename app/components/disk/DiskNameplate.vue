<script setup lang="ts">
import { displayName } from "./displayName";
import type { DiskDetail } from "./types";

const props = defineProps<{ disk: DiskDetail }>();
defineEmits<{ updated: [disk: DiskDetail] }>();

const name = computed(() => displayName(props.disk));

const protocolLabel = computed(() =>
  [props.disk.protocol, props.disk.link]
    .filter((part) => part && part !== "unknown")
    .join(" / "),
);

const facts = computed(() => [
  { label: "Capacity", value: formatBytes(props.disk.capacityBytes) },
  { label: "Firmware", value: props.disk.firmware ?? "—", mono: true },
  { label: "Protocol", value: protocolLabel.value || "—" },
  { label: "Device", value: props.disk.lastDevicePath ?? "—", mono: true },
  { label: "First seen", value: formatDate(props.disk.firstSeenAt) },
  { label: "Last seen", value: formatDate(props.disk.lastSeenAt) },
  { label: "Power-on", value: formatHours(props.disk.latestPowerOnHours) },
  {
    label: "Power cycles",
    value: props.disk.latestPowerCycles?.toLocaleString("en-GB") ?? "—",
  },
  { label: "Temperature", value: formatCelsius(props.disk.latestTemp) },
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
        <p class="text-muted text-sm">
          {{ disk.model ?? "Unknown model" }}
          <span v-if="disk.serial" class="text-default font-mono">
            · {{ disk.serial }}
          </span>
        </p>
      </div>
      <div class="flex flex-col items-end gap-2">
        <UBadge
          :color="deviceStatusColour(disk.latestStatus)"
          variant="subtle"
          :label="`SMART ${disk.latestStatus}`"
        />
        <DiskStateControl :disk="disk" @updated="$emit('updated', $event)" />
      </div>
    </div>

    <dl class="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3 lg:grid-cols-5">
      <div class="flex flex-col">
        <dt class="text-dimmed text-xs">Host</dt>
        <dd>
          <ULink
            v-if="disk.hostName"
            to="/settings/hosts"
            class="text-default hover:text-primary"
          >
            {{ disk.hostName }}
          </ULink>
          <span v-else>—</span>
        </dd>
      </div>
      <div v-for="fact in facts" :key="fact.label" class="flex flex-col">
        <dt class="text-dimmed text-xs">{{ fact.label }}</dt>
        <dd class="tabular truncate" :class="{ 'font-mono text-xs leading-5': fact.mono }">
          {{ fact.value }}
        </dd>
      </div>
    </dl>
  </section>
</template>

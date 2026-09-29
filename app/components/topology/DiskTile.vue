<script setup lang="ts">
import { NuxtLink } from "#components";
import { temperatureColour } from "#shared/temperature";
import {
  PURPOSE_BADGE,
  STATUS_TEXT_CLASS,
  zfsStateColour,
} from "~/utils/vocabulary";
import {
  diskDot,
  diskLabel,
  hasErrors,
  leafLabel,
  type TopologyDisk,
  type TopologyVdev,
  tileColour,
} from "./groupDisks";

const props = defineProps<
  { leaf: TopologyVdev; disk?: never } | { disk: TopologyDisk; leaf?: never }
>();

const facts = computed(() => (props.leaf ? props.leaf.disk : props.disk));
const label = computed(() =>
  props.leaf ? leafLabel(props.leaf) : diskLabel(props.disk),
);
const dot = computed(() =>
  props.leaf ? tileColour(props.leaf) : diskDot(props.disk),
);
const purposeBadge = computed(() =>
  facts.value?.purpose ? PURPOSE_BADGE[facts.value.purpose] : null,
);

const offlineState = computed(() =>
  props.leaf && props.leaf.state !== "ONLINE" ? props.leaf.state : null,
);

const counters = computed(() => {
  const leaf = props.leaf;
  if (!leaf) return [];
  return (
    [
      ["R", leaf.readErrors],
      ["W", leaf.writeErrors],
      ["C", leaf.checksumErrors],
    ] as const
  ).filter(([, count]) => count > 0);
});
const slowIos = computed(() => props.leaf?.slowIos ?? 0);
const showCounters = computed(
  () => !!props.leaf && (hasErrors(props.leaf) || slowIos.value > 0),
);

const temperature = computed(() => {
  const celsius = facts.value?.latestTemp ?? null;
  if (celsius === null || !facts.value) return null;
  const colour = temperatureColour(celsius, facts.value.tempThresholds);
  return {
    text: `${celsius}°`,
    class: colour === "neutral" ? undefined : STATUS_TEXT_CLASS[colour],
  };
});

const tooltip = computed(() =>
  [
    props.disk?.model,
    props.disk?.serial,
    props.disk?.interfaceLabel,
    props.leaf ? (props.leaf.path ?? props.leaf.name) : null,
  ]
    .filter(Boolean)
    .join(" · "),
);
</script>

<template>
  <UTooltip :text="tooltip" :disabled="!tooltip">
    <component
      :is="facts ? NuxtLink : 'div'"
      :to="facts ? `/disks/${facts.id}` : undefined"
      class="bg-elevated border-default flex h-20 w-36 flex-col justify-between rounded-md border px-2 py-1.5 text-xs"
      :class="
        facts
          ? 'hover:border-accented transition duration-150 hover:-translate-y-px'
          : 'border-dashed'
      "
      data-testid="disk-tile"
    >
      <span class="flex items-center gap-1">
        <span
          class="truncate text-sm font-semibold"
          data-testid="disk-tile-label"
          :class="facts ? 'text-highlighted' : 'text-muted'"
        >
          {{ label }}
        </span>
        <UBadge v-if="purposeBadge" v-bind="purposeBadge" class="shrink-0" />
        <TopologyStatusDot
          :colour="dot.colour"
          :shape="dot.shape"
          class="ml-auto"
        />
      </span>

      <span
        v-if="offlineState"
        :class="STATUS_TEXT_CLASS[zfsStateColour(offlineState)]"
        data-testid="disk-tile-state"
      >
        {{ offlineState }}
      </span>
      <span v-else-if="!facts" class="text-dimmed">unlinked</span>
      <span v-else class="text-dimmed truncate" data-testid="disk-tile-model">
        {{ facts.modelShort ?? "" }}
      </span>

      <span class="flex items-center gap-1">
        <span
          v-if="showCounters"
          class="tabular font-mono"
          data-testid="disk-tile-counters"
        >
          <span
            v-for="[name, count] in counters"
            :key="name"
            class="text-error mr-1"
          >
            {{ name }}{{ count }}
          </span>
          <span v-if="slowIos > 0" class="text-warning">S{{ slowIos }}</span>
        </span>
        <span
          v-else-if="facts"
          class="text-muted tabular"
          data-testid="disk-tile-facts"
        >
          {{ formatBytes(facts.capacityBytes) }} ·
          <span :class="temperature?.class" data-testid="disk-tile-temp">
            {{ temperature?.text ?? "—" }}
          </span>
        </span>
        <MediaGlyph
          v-if="facts"
          :media="facts.media"
          :size="16"
          class="text-muted ml-auto"
        />
      </span>
    </component>
  </UTooltip>
</template>

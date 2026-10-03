<script setup lang="ts">
import { DEVICE_STATUS_VOCABULARY } from "~/utils/vocabulary";
import { ALL } from "./filterDisks";

const props = defineProps<{
  options: FilterOption[];
  icon: string;
  counts: ReadonlyMap<string, number>;
  placeholder?: string;
}>();

const selected = defineModel<string | string[]>({ required: true });

const multiple = computed(() => Array.isArray(selected.value));

const selectedValues = computed(() => {
  if (Array.isArray(selected.value)) return selected.value;
  return selected.value === ALL ? [] : [selected.value];
});

const active = computed(() => selectedValues.value.length > 0);

const leadingOption = computed(() =>
  selectedValues.value.length === 1
    ? props.options.find(({ value }) => value === selectedValues.value[0])
    : undefined,
);

const statusDot = (status: DeviceStatus) => {
  const { colour, shape } = DEVICE_STATUS_VOCABULARY[status];
  return { colour, shape };
};
</script>

<script lang="ts">
import type { Media } from "#shared/hardware";
import type { DeviceStatus } from "#shared/smart/status";

export interface FilterOption {
  value: string;
  label: string;
  icon?: string;
  media?: Media;
  status?: DeviceStatus;
}
</script>

<template>
  <USelect
    :model-value="selected"
    :items="options"
    :multiple="multiple"
    :placeholder="placeholder"
    :color="active ? 'primary' : 'neutral'"
    :variant="active ? 'soft' : 'outline'"
    :highlight="active"
    :data-active="active || undefined"
    @update:model-value="selected = $event"
  >
    <template #leading="{ ui }">
      <MediaGlyph
        v-if="leadingOption?.media"
        :media="leadingOption.media"
        :class="ui.leadingIcon()"
      />
      <span
        v-else-if="leadingOption?.status"
        class="inline-flex items-center justify-center"
        :class="ui.leadingIcon()"
      >
        <TopologyStatusDot v-bind="statusDot(leadingOption.status)" />
      </span>
      <UIcon
        v-else
        :name="leadingOption?.icon ?? icon"
        :class="ui.leadingIcon()"
        data-testid="filter-icon"
      />
    </template>
    <template #item-leading="{ item, ui }">
      <MediaGlyph
        v-if="item.media"
        :media="item.media"
        :class="ui.itemLeadingIcon()"
      />
      <span
        v-else-if="item.status"
        class="inline-flex items-center justify-center"
        :class="ui.itemLeadingIcon()"
      >
        <TopologyStatusDot v-bind="statusDot(item.status)" />
      </span>
      <UIcon
        v-else-if="item.icon"
        :name="item.icon"
        :class="ui.itemLeadingIcon()"
      />
    </template>
    <template #item-trailing="{ item }">
      <span class="text-dimmed text-xs tabular-nums" data-testid="filter-count">
        {{ counts.get(item.value) ?? 0 }}
      </span>
    </template>
  </USelect>
</template>

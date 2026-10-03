<script setup lang="ts">
import type { BadgeProps } from "@nuxt/ui";
import type { Disposal } from "#shared/disk";
import { DISPOSAL_VOCABULARY, disposalLabel } from "~/utils/vocabulary";

const props = withDefaults(
  defineProps<{
    disposal: Disposal;
    replacedByDiskId: number | null;
    replacedByLabel?: string | null;
    size?: BadgeProps["size"];
  }>(),
  { replacedByLabel: null, size: undefined },
);

const vocabulary = computed(() => DISPOSAL_VOCABULARY[props.disposal.kind]);

const label = computed(() =>
  disposalLabel(props.disposal, {
    replacedByDiskId: props.replacedByDiskId,
    replacedByLabel: props.replacedByLabel,
  }),
);
</script>

<template>
  <UBadge
    :icon="vocabulary.icon"
    :label="label"
    :color="vocabulary.colour"
    variant="subtle"
    :size="size"
    :title="`Disposed ${disposal.on}`"
    :data-disposal="disposal.kind"
  />
</template>

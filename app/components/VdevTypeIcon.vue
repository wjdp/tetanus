<script setup lang="ts">
import { vdevTypeVocabulary } from "~/utils/vocabulary";

const props = defineProps<{ type: string }>();

const vocabulary = computed(() => vdevTypeVocabulary(props.type));
</script>

<template>
  <UIcon
    v-if="vocabulary"
    :name="vocabulary.icon"
    class="size-4 shrink-0 text-muted"
    :data-vdev-type="type"
  />
</template>

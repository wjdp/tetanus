<script setup lang="ts">
import { DAMAGED_FILES_LIMIT } from "#shared/zfsState";

const COLLAPSED_COUNT = 10;

const props = defineProps<{
  errors: number;
  files: string[] | null;
  listError: string | null;
}>();

const showAll = ref(false);

const listed = computed(() => props.files ?? []);
const shown = computed(() =>
  showAll.value ? listed.value : listed.value.slice(0, COLLAPSED_COUNT),
);
const hiddenCount = computed(() => listed.value.length - shown.value.length);
const unlistedCount = computed(() =>
  listed.value.length >= DAMAGED_FILES_LIMIT
    ? Math.max(0, props.errors - listed.value.length)
    : 0,
);
</script>

<template>
  <div class="flex flex-col gap-1 text-sm" data-testid="damaged-files">
    <p v-if="listError" class="text-muted">
      Damaged file list unavailable: {{ listError }}
    </p>
    <template v-else-if="listed.length">
      <p class="text-muted">Permanent errors in:</p>
      <ul class="text-error flex flex-col font-mono text-xs break-all">
        <li v-for="file in shown" :key="file">{{ file }}</li>
      </ul>
      <p
        v-if="unlistedCount"
        class="text-muted text-xs"
        data-testid="damaged-files-unlisted"
      >
        +{{ unlistedCount }} more not listed
      </p>
      <UButton
        v-if="listed.length > COLLAPSED_COUNT"
        color="neutral"
        variant="link"
        size="xs"
        class="self-start px-0"
        :icon="showAll ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
        :label="showAll ? 'Show fewer' : `Show ${hiddenCount} more`"
        data-testid="damaged-files-toggle"
        @click="showAll = !showAll"
      />
    </template>
  </div>
</template>

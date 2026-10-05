<script setup lang="ts">
import {
  allocationClassVdevs,
  type ClassVdev,
  mainVdevFree,
} from "./allocationClasses";
import type { PoolVdev } from "./types";

const props = defineProps<{
  vdevs: PoolVdev | null;
  freeBytes: number | null;
}>();

const ROLE_REASON: Record<ClassVdev["role"], string> = {
  special: "ZFS stores metadata and small blocks on it and nothing else",
  dedup: "ZFS stores only the dedup table on it",
};

const { formatZfsBytes } = useZfsByteSystem();

const classVdevs = computed(() => allocationClassVdevs(props.vdevs));

const groups = computed(() =>
  (["special", "dedup"] as const).flatMap((role) => {
    const vdevs = classVdevs.value.filter((entry) => entry.role === role);
    if (vdevs.length === 0) return [];
    return [
      {
        role,
        noun: vdevs.length === 1 ? `a ${role} vdev` : `${role} vdevs`,
        vdevs,
        reason: ROLE_REASON[role],
      },
    ];
  }),
);

const mainFree = computed(() =>
  mainVdevFree(props.freeBytes, classVdevs.value),
);
</script>

<template>
  <UPopover
    v-if="classVdevs.length > 0"
    :content="{ side: 'top', align: 'start' }"
  >
    <button
      type="button"
      class="hover:text-default focus-visible:outline-primary inline-flex rounded-sm focus-visible:outline-2"
      aria-label="Why is Available lower than raw free?"
      data-testid="available-note"
    >
      <UIcon name="i-lucide-info" class="size-3.5" />
    </button>
    <template #content>
      <div class="text-default flex max-w-xs flex-col gap-2 p-3 text-sm">
        <p class="text-highlighted font-medium">
          Why is Available lower than raw free?
        </p>
        <p v-for="group in groups" :key="group.role">
          This pool has {{ group.noun }} (<template
            v-for="(entry, index) in group.vdevs"
            :key="entry.name"
            ><template v-if="index > 0">; </template
            ><span class="font-mono">{{ entry.name }}</span
            ><template v-if="entry.sizeBytes !== null"
              >, {{ formatZfsBytes(entry.sizeBytes) }}</template
            ></template
          >). Its space counts in the raw size and free, but not in Available,
          because {{ group.reason }}.
        </p>
        <p v-if="mainFree !== null" class="text-muted tabular">
          Raw free on the main vdevs ≈ {{ formatZfsBytes(mainFree) }}
        </p>
      </div>
    </template>
  </UPopover>
</template>

<script setup lang="ts">
import { PURPOSE_BADGE } from "~/utils/vocabulary";
import {
  type DiskGroup,
  diskDot,
  diskLabel,
  HISTORY_KEY,
  type TopologyDisk,
} from "./groupDisks";

defineProps<{
  groups: DiskGroup<TopologyDisk & { hostName: string | null }>[];
}>();

const HISTORY_STORAGE_KEY = "topology.historyOpen";

const historyOpen = ref(false);

onMounted(() => {
  try {
    historyOpen.value = localStorage.getItem(HISTORY_STORAGE_KEY) === "true";
  } catch {}
});

function toggleHistory() {
  historyOpen.value = !historyOpen.value;
  try {
    localStorage.setItem(HISTORY_STORAGE_KEY, String(historyOpen.value));
  } catch {}
}
</script>

<template>
  <aside class="flex flex-col gap-4" data-testid="disk-rail">
    <p v-if="groups.length === 0" class="text-dimmed text-sm">
      Every known disk is attached to a host.
    </p>
    <section
      v-for="group in groups"
      :key="group.key"
      class="flex flex-col gap-1"
      :data-group="group.key"
    >
      <component
        :is="group.key === HISTORY_KEY ? 'button' : 'h3'"
        class="text-toned flex items-center gap-1.5 text-left text-sm font-semibold"
        v-bind="
          group.key === HISTORY_KEY
            ? {
                type: 'button',
                'aria-expanded': historyOpen,
                'data-testid': 'history-toggle',
                onClick: toggleHistory,
              }
            : {}
        "
      >
        <UIcon :name="group.icon" class="text-muted size-4 shrink-0" />
        {{ group.label }}
        <span class="text-dimmed tabular font-normal">
          {{ group.disks.length }}
        </span>
        <UIcon
          v-if="group.key === HISTORY_KEY"
          name="i-lucide-chevron-down"
          class="text-dimmed size-4 transition-transform"
          :class="historyOpen ? '' : '-rotate-90'"
        />
      </component>
      <ul
        v-show="group.key !== HISTORY_KEY || historyOpen"
        class="flex flex-col"
      >
        <li v-for="disk in group.disks" :key="disk.id">
          <NuxtLink
            :to="`/disks/${disk.id}`"
            class="hover:bg-elevated flex items-center gap-2 rounded-md px-2 py-1 text-sm"
          >
            <TopologyStatusDot v-bind="diskDot(disk)" />
            <MediaGlyph :media="disk.media" :size="16" class="text-muted" />
            <span class="text-highlighted font-semibold">
              {{ diskLabel(disk) }}
            </span>
            <UBadge v-if="disk.purpose" v-bind="PURPOSE_BADGE[disk.purpose]" />
            <span class="text-muted min-w-0 flex-1 truncate">
              {{ disk.modelShort ?? "" }}
            </span>
            <span class="text-dimmed tabular text-xs">
              {{ formatBytes(disk.capacityBytes) }}
            </span>
            <span v-if="disk.hostName" class="text-dimmed text-xs">
              {{ disk.hostName }}
            </span>
          </NuxtLink>
        </li>
      </ul>
    </section>
  </aside>
</template>

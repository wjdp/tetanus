<script setup lang="ts">
import { type RailGroup, railColour, type TopologyDisk } from "./groupDisks";

defineProps<{
  groups: RailGroup<TopologyDisk & { hostName: string | null }>[];
}>();
</script>

<template>
  <aside class="flex flex-col gap-4" data-testid="disk-rail">
    <p v-if="groups.length === 0" class="text-dimmed text-sm">
      Every known disk is in a pool.
    </p>
    <section
      v-for="group in groups"
      :key="group.key"
      class="flex flex-col gap-1"
    >
      <h3 class="text-toned text-sm font-semibold">
        {{ group.label }}
        <span class="text-dimmed tabular font-normal">
          {{ group.disks.length }}
        </span>
      </h3>
      <ul class="flex flex-col">
        <li v-for="disk in group.disks" :key="disk.id">
          <NuxtLink
            :to="`/disks/${disk.id}`"
            class="hover:bg-elevated flex items-center gap-2 rounded-md px-2 py-1 text-sm"
          >
            <TopologyStatusDot :colour="railColour(disk)" />
            <UIcon
              v-if="mediaIcon(disk.media)"
              :name="mediaIcon(disk.media) ?? ''"
              class="text-muted size-4 shrink-0"
              :title="disk.media ?? undefined"
            />
            <span class="text-highlighted font-semibold">
              {{ disk.alias ?? disk.serial ?? `#${disk.id}` }}
            </span>
            <UBadge
              v-if="disk.purpose === 'other'"
              size="xs"
              variant="subtle"
              color="neutral"
              label="other"
            />
            <span class="text-muted min-w-0 flex-1 truncate">
              {{ disk.model ?? "" }}
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

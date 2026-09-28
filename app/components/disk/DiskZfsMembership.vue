<script setup lang="ts">
import type { DiskDetail } from "./types";

const props = defineProps<{ membership: DiskDetail["membership"] }>();

const leafName = computed(
  () => props.membership?.vdevName.split("/").at(-1) ?? "",
);

const groupName = computed(() =>
  props.membership?.groupType === "root" ? null : props.membership?.groupName,
);
</script>

<template>
  <section class="flex flex-col gap-3">
    <h2 class="text-highlighted text-lg font-semibold">ZFS</h2>

    <p v-if="!membership" class="text-muted text-sm">Not a member of any pool.</p>
    <div
      v-else
      class="border-default flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border p-4 text-sm"
    >
      <div class="flex items-center gap-1.5">
        <ULink
          :to="`/zfs/${membership.poolId}`"
          class="text-highlighted hover:text-primary font-medium"
        >
          {{ membership.poolName }}
        </ULink>
        <template v-if="groupName">
          <UIcon name="i-lucide-chevron-right" class="text-dimmed size-4" />
          <span class="text-default">{{ groupName }}</span>
        </template>
        <UIcon name="i-lucide-chevron-right" class="text-dimmed size-4" />
        <span class="text-default font-mono text-xs" :title="membership.vdevName">
          {{ leafName }}
        </span>
      </div>
      <UBadge
        :color="zfsStateColour(membership.vdevState)"
        variant="subtle"
        :label="membership.vdevState"
      />
    </div>
  </section>
</template>

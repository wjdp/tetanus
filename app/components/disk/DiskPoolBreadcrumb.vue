<script setup lang="ts">
import { zfsStateColour } from "~/utils/vocabulary";
import type { DiskDetail } from "./types";

const props = withDefaults(
  defineProps<{
    membership: NonNullable<DiskDetail["membership"]>;
    showState?: boolean;
  }>(),
  { showState: false },
);

const leafName = computed(() => props.membership.vdevName.split("/").at(-1));

const isTopLevelDisk = computed(() => props.membership.groupType === "root");

const groupName = computed(() =>
  isTopLevelDisk.value ? null : props.membership.groupName,
);
</script>

<template>
  <span
    class="inline-flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm"
    :class="{ 'opacity-60': membership.poolArchived }"
    :data-archived="membership.poolArchived"
    data-testid="pool-breadcrumb"
  >
    <span class="inline-flex min-w-0 items-center gap-1">
      <ULink
        :to="`/zfs/${membership.poolId}`"
        class="text-highlighted hover:text-primary font-medium"
      >
        {{ membership.poolName }}
      </ULink>
      <template v-if="groupName">
        <UIcon name="i-lucide-chevron-right" class="text-dimmed size-4" />
        <VdevTypeIcon v-if="membership.groupType" :type="membership.groupType" />
        <span class="text-default">{{ groupName }}</span>
      </template>
      <UIcon name="i-lucide-chevron-right" class="text-dimmed size-4" />
      <VdevTypeIcon v-if="isTopLevelDisk" type="disk" />
      <span class="text-default truncate font-mono text-xs" :title="membership.vdevName">
        {{ leafName }}
      </span>
    </span>
    <UBadge
      v-if="showState"
      :color="zfsStateColour(membership.vdevState)"
      variant="subtle"
      size="sm"
      :label="membership.vdevState"
      data-testid="membership-state"
    />
    <UBadge
      v-if="membership.poolArchived"
      color="neutral"
      variant="outline"
      size="sm"
      icon="i-lucide-archive"
      label="archived pool"
      data-testid="membership-archived"
    />
  </span>
</template>

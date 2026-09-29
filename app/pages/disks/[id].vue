<script setup lang="ts">
import { getPageTitle } from "#shared/app";
import { displayName } from "~/components/disk/displayName";
import type { DiskDetail } from "~/components/disk/types";

const route = useRoute();
const diskId = computed(() => Number(route.params.id));

const {
  data: disk,
  error,
  refresh,
} = await useFetch<DiskDetail>(() => `/api/disks/${diskId.value}`);

const heading = computed(
  () =>
    (disk.value && displayName(disk.value)) ??
    disk.value?.model ??
    `Disk ${diskId.value}`,
);

useSeoMeta({ title: () => getPageTitle(heading.value) });

const onUpdated = (updated: DiskDetail) => {
  disk.value = updated;
};
</script>

<template>
  <AppPanel :title="heading" class="max-w-7xl">
    <div class="flex flex-col gap-10">
      <UButton
        to="/disks"
        color="neutral"
        variant="ghost"
        icon="i-lucide-arrow-left"
        label="Disks"
        class="-ml-2.5 self-start"
      />

      <p v-if="error || !disk" class="text-muted">
        {{ error?.statusCode === 404 ? "No such disk." : "Could not load the disk." }}
      </p>

      <template v-else>
        <DiskNameplate :disk="disk" @updated="onUpdated" />

        <section class="flex flex-col gap-4">
          <h2 class="text-highlighted text-lg font-semibold">Inventory</h2>
          <DiskInventoryForm :disk="disk" @updated="onUpdated" />
        </section>

        <DiskSmart
          :disk-id="disk.id"
          :protocol="disk.protocol"
          @changed="refresh"
        />

        <DiskZfsMembership :membership="disk.membership" />

        <DiskDiary :disk-id="disk.id" :entries="disk.diary" @changed="refresh" />
      </template>
    </div>
  </AppPanel>
</template>

<script setup lang="ts">
import { getPageTitle } from "#shared/app";
import { diskLabel, displayName } from "~/components/disk/displayName";
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

const { data: allDisks, refresh: refreshDiskList } = useDiskList();

const labelOf = (id: number | null) => {
  if (id === null) return null;
  const found = allDisks.value.find((candidate) => candidate.id === id);
  return found ? diskLabel(found) : null;
};

const label = computed(() =>
  disk.value ? diskLabel(disk.value) : `disk ${diskId.value}`,
);

const disposedDisk = computed(() =>
  disk.value?.disposal ? { ...disk.value, disposal: disk.value.disposal } : null,
);

const onUpdated = (updated: DiskDetail) => {
  disk.value = updated;
  refreshDiskList();
};
</script>

<template>
  <AppPanel :title="heading" class="max-w-7xl">
    <div class="flex flex-col gap-10">
      <div class="flex items-center justify-between gap-4">
        <UButton
          to="/disks"
          color="neutral"
          variant="ghost"
          icon="i-lucide-arrow-left"
          label="Disks"
          class="-ml-2.5"
        />
        <div v-if="disk" class="flex items-center gap-2">
          <SimulateFaultMenu subject-type="disk" :subject-id="disk.id" />
          <UTooltip
            text="Includes serials, hostnames and mount paths. Check before posting publicly."
          >
            <UButton
              :to="`/api/disks/${disk.id}/diagnostics`"
              external
              download
              color="neutral"
              variant="outline"
              icon="i-lucide-file-archive"
              label="Download diagnostics"
            />
          </UTooltip>
        </div>
      </div>

      <p v-if="error || !disk" class="text-muted">
        {{ error?.statusCode === 404 ? "No such disk." : "Could not load the disk." }}
      </p>

      <template v-else>
        <DiskDisposalBanner
          v-if="disposedDisk"
          :disk="disposedDisk"
          :label="label"
          :replaced-by-label="labelOf(disposedDisk.replacedByDiskId)"
          @updated="onUpdated"
        />

        <DiskNameplate
          :disk="disk"
          :replaces-label="labelOf(disk.replacesDiskId)"
          @updated="onUpdated"
        />

        <section class="flex flex-col gap-4">
          <h2 class="text-highlighted text-lg font-semibold">Inventory</h2>
          <DiskInventoryForm
            :disk="disk"
            :disks="allDisks"
            @updated="onUpdated"
          />
        </section>

        <DiskSpecs :disk="disk" />

        <DiskSmart
          :disk-id="disk.id"
          :protocol="disk.protocol"
          @changed="refresh"
        />

        <DiskZfsMembership :membership="disk.membership" />

        <DiaryPanel
          subject-type="disk"
          :subject-id="disk.id"
          :entries="disk.diary"
          @changed="refresh"
        />
      </template>
    </div>
  </AppPanel>
</template>

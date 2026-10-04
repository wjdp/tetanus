<script setup lang="ts">
import { displayModel } from "#shared/model";
import type { EditableFieldKey } from "./DiskEditableField.vue";
import { diskLabel } from "./displayName";
import type { DiskDetail, ReplacementCandidate } from "./types";
import { useDiskFieldSave } from "./useDiskFieldSave";

const props = withDefaults(
  defineProps<{
    order: readonly number[];
    disks?: ReplacementCandidate[];
  }>(),
  { disks: () => [] },
);

const emit = defineEmits<{ updated: [disk: DiskDetail] }>();

const diskId = defineModel<number | null>("diskId", { required: true });

const FIELD_GROUPS: { title: string; keys: EditableFieldKey[] }[] = [
  {
    title: "Identity",
    keys: ["vendorOverride", "seagateBpid", "shuckedFrom", "modelShort"],
  },
  { title: "Hardware", keys: ["recordingTech"] },
  { title: "Placement", keys: ["storageLocation", "bay", "purpose"] },
];

const toast = useToast();

const disk = ref<DiskDetail | null>(null);
const loadFailed = ref(false);
const loaded = new Map<number, DiskDetail>();

const open = computed({
  get: () => diskId.value !== null,
  set: (isOpen) => {
    if (!isOpen) diskId.value = null;
  },
});

const position = computed(() =>
  diskId.value === null ? -1 : props.order.indexOf(diskId.value),
);

const previousId = computed(() =>
  position.value > 0 ? (props.order[position.value - 1] ?? null) : null,
);

const nextId = computed(() =>
  position.value >= 0 ? (props.order[position.value + 1] ?? null) : null,
);

function onUpdated(updated: DiskDetail) {
  loaded.set(updated.id, updated);
  if (updated.id === disk.value?.id) disk.value = updated;
  emit("updated", updated);
}

const { saving, errors, save } = useDiskFieldSave(
  () => disk.value?.id ?? 0,
  onUpdated,
);

const fetchDisk = async (id: number) => {
  const detail = await $fetch<DiskDetail>(`/api/disks/${id}`);
  loaded.set(id, detail);
  return detail;
};

const prefetchNeighbours = () => {
  for (const id of [previousId.value, nextId.value]) {
    if (id !== null && !loaded.has(id)) fetchDisk(id).catch(() => {});
  }
};

watch(
  diskId,
  async (id, previous) => {
    loadFailed.value = false;
    errors.alias = null;
    if (id === null) {
      loaded.clear();
      return;
    }
    if (previous === null) disk.value = null;
    const cached = loaded.get(id);
    if (cached) {
      disk.value = cached;
      prefetchNeighbours();
      return;
    }
    try {
      const detail = await fetchDisk(id);
      if (diskId.value !== id) return;
      disk.value = detail;
      prefetchNeighbours();
    } catch (error) {
      if (diskId.value !== id) return;
      loadFailed.value = true;
      if (isNetworkFailure(error))
        toast.add({ title: "Could not reach the server", color: "error" });
    }
  },
  { immediate: true },
);

const saveAlias = (alias: unknown) =>
  save("alias", { alias: typeof alias === "string" ? alias : null });

const headerDisk = computed(
  () =>
    disk.value ??
    props.disks.find((candidate) => candidate.id === diskId.value) ??
    null,
);

const title = computed(() =>
  headerDisk.value ? diskLabel(headerDisk.value) : "Disk",
);

const model = computed(() =>
  disk.value
    ? displayModel(disk.value.model, disk.value.vendor)
    : null,
);
</script>

<template>
  <USlideover
    v-model:open="open"
    :title="title"
    :ui="{
      content: 'max-w-xl',
      header: 'gap-2',
      wrapper: 'relative min-w-0 flex-1 ps-9',
      description: 'mt-0.5 truncate',
      close: 'static',
      body: 'flex flex-col gap-4',
    }"
  >
    <template #title>
      <MediaGlyph
        :media="disk?.media ?? null"
        :size="24"
        class="text-muted absolute start-0 top-1/2 -translate-y-1/2"
        data-testid="drawer-media"
      />
      {{ title }}
    </template>

    <template v-if="model" #description>{{ model }}</template>

    <template #actions>
      <UFieldGroup>
        <UButton
          color="neutral"
          variant="outline"
          icon="i-lucide-chevron-up"
          aria-label="Previous disk"
          :disabled="previousId === null"
          data-testid="drawer-previous"
          @click="diskId = previousId"
        />
        <UBadge
          v-if="position >= 0"
          color="neutral"
          variant="outline"
          class="text-sm tabular-nums"
          data-testid="drawer-position"
        >
          {{ position + 1 }} / {{ order.length }}
        </UBadge>
        <UButton
          color="neutral"
          variant="outline"
          icon="i-lucide-chevron-down"
          aria-label="Next disk"
          :disabled="nextId === null"
          data-testid="drawer-next"
          @click="diskId = nextId"
        />
      </UFieldGroup>
      <UButton
        v-if="diskId !== null"
        :to="`/disks/${diskId}`"
        color="neutral"
        variant="ghost"
        icon="i-lucide-arrow-up-right"
        aria-label="Open disk page"
        data-testid="drawer-disk-link"
      />
    </template>

    <template #body>
      <p v-if="loadFailed" class="text-muted">Could not load the disk.</p>
      <div v-else-if="!disk" class="flex justify-center py-6">
        <UIcon name="i-lucide-loader-circle" class="text-dimmed size-5 animate-spin" />
      </div>
      <template v-else>
        <DiskFactGroup
          v-for="group in FIELD_GROUPS"
          :key="`${disk.id}-${group.title}`"
          :title="group.title"
          :data-testid="`drawer-group-${group.title.toLowerCase()}`"
        >
          <template v-if="group.title === 'Identity'">
            <InlineField
              type="text"
              label="Alias"
              :value="disk.alias"
              :saving="saving.alias"
              :error="errors.alias"
              data-field="alias"
              @commit="saveAlias"
            />
            <DiskFact label="Model" :value="disk.model" />
            <DiskFact label="Serial" :value="disk.serial" mono />
          </template>
          <DiskEditableField
            v-for="key in group.keys"
            :key="key"
            :field-key="key"
            :disk="disk"
            :disks="disks"
            @updated="onUpdated"
          />
        </DiskFactGroup>
        <DiskOwnership
          :key="`${disk.id}-ownership`"
          :disk="disk"
          :disks="disks"
          @updated="onUpdated"
        />
        <DiskNotes
          :key="`${disk.id}-notes`"
          :disk="disk"
          @updated="onUpdated"
        />
      </template>
    </template>
  </USlideover>
</template>

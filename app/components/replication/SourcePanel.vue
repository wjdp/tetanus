<script setup lang="ts">
import { useDatasetSearch } from "../dataset/useDatasetSearch";
import { hostLabel } from "./groups";
import { patchReplication } from "./patch";
import type { ReplicationDetail } from "./types";

const props = defineProps<{ replication: ReplicationDetail }>();
const emit = defineEmits<{ saved: [] }>();

const toast = useToast();
const saving = ref(false);
const choosing = ref(false);
const chosenId = ref<number | undefined>();
const searchTerm = ref("");
const { results, loading } = useDatasetSearch(searchTerm);

const items = computed(() =>
  datasetSubjectItems(
    results.value.filter(
      (dataset) => dataset.id !== props.replication.target.dataset.id,
    ),
  ),
);

const save = async (sourceDatasetId: number | null) => {
  saving.value = true;
  try {
    await patchReplication(props.replication.id, { sourceDatasetId });
    choosing.value = false;
    chosenId.value = undefined;
    searchTerm.value = "";
    emit("saved");
  } catch (error) {
    toast.add({
      title: "Could not change the source",
      description: (error as { data?: { message?: string } }).data?.message,
      color: "error",
    });
  } finally {
    saving.value = false;
  }
};

const submit = () => {
  if (chosenId.value !== undefined) save(chosenId.value);
};
</script>

<template>
  <section
    class="border-default flex flex-col gap-3 rounded-lg border p-4"
    data-testid="source-panel"
  >
    <h2 class="text-highlighted font-semibold">Source</h2>
    <p v-if="replication.source" class="flex flex-wrap items-center gap-2 text-sm">
      <span class="text-muted">{{ hostLabel(replication.source) }}</span>
      <NuxtLink
        :to="`/datasets/${replication.source.dataset.id}`"
        class="text-highlighted font-mono hover:underline"
      >
        {{ replication.source.dataset.name }}
      </NuxtLink>
      <UBadge
        v-if="!replication.source.dataset.present"
        color="neutral"
        variant="subtle"
        size="sm"
      >
        destroyed
      </UBadge>
    </p>
    <p v-else class="text-muted text-sm">
      Not monitored: no dataset on a monitored pool shares a snapshot with the
      target.
    </p>
    <p class="text-muted text-sm">
      {{
        replication.direction === "manual"
          ? "Set by hand."
          : "Found by the snapshots it shares with the target; decided once."
      }}
    </p>

    <form
      v-if="choosing"
      class="flex flex-wrap items-end gap-2"
      data-testid="source-form"
      @submit.prevent="submit"
    >
      <UFormField label="Source dataset" name="sourceDatasetId" class="min-w-64 flex-1">
        <USelectMenu
          v-model="chosenId"
          v-model:search-term="searchTerm"
          :items="items"
          value-key="value"
          ignore-filter
          :loading="loading"
          placeholder="Choose a dataset"
          class="w-full"
          data-testid="source-picker"
        >
          <template v-if="!searchTerm.trim()" #empty>
            Type part of a dataset name to search.
          </template>
        </USelectMenu>
      </UFormField>
      <UButton
        type="submit"
        color="neutral"
        variant="soft"
        label="Set source"
        :disabled="chosenId === undefined"
        :loading="saving"
      />
      <UButton
        color="neutral"
        variant="ghost"
        label="Cancel"
        @click="choosing = false"
      />
    </form>
    <div v-else class="flex flex-wrap gap-2">
      <UButton
        color="neutral"
        variant="soft"
        size="sm"
        icon="i-lucide-pencil"
        label="Choose source"
        data-testid="source-choose"
        @click="choosing = true"
      />
      <UButton
        v-if="replication.direction === 'manual'"
        color="neutral"
        variant="ghost"
        size="sm"
        icon="i-lucide-rotate-ccw"
        label="Rediscover"
        :loading="saving"
        data-testid="source-rediscover"
        @click="save(null)"
      />
    </div>
  </section>
</template>

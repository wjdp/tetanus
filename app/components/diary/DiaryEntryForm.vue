<script setup lang="ts">
import { DIARY_SUBJECT_TYPES, type DiarySubjectType } from "#shared/diary";
import { useDatasetSearch } from "~/components/dataset/useDatasetSearch";

const props = defineProps<{
  subjectType?: DiarySubjectType;
  subjectId?: number | null;
  fixedSubject?: boolean;
}>();

const emit = defineEmits<{ saved: [] }>();

const subjectType = ref<DiarySubjectType>(props.subjectType ?? "disk");
const subjectId = ref<number | undefined>(props.subjectId ?? undefined);
const title = ref("");
const body = ref("");
const saving = ref(false);
const toast = useToast();

const subjectTypeItems = DIARY_SUBJECT_TYPES.map((value) => ({
  label: value,
  value,
  icon: DIARY_SUBJECT_ICON[value],
}));

const needsSubjectId = computed(() => subjectType.value !== "system");

const { data: listedItems, status: listedItemsStatus } = useLazyAsyncData(
  () => `diary-subject-items:${subjectType.value}`,
  () => fetchSubjectItems(subjectType.value),
  { server: false, default: () => [], immediate: !props.fixedSubject },
);

const isSearched = computed(() => subjectType.value === "dataset");
const searchTerm = ref("");
const { results: datasetResults, loading: datasetsLoading } =
  useDatasetSearch(searchTerm);
const seenDatasets = reactive(new Map<number, SubjectItem>());

const rememberPrefilledDataset = async () => {
  const id = subjectId.value;
  if (
    props.fixedSubject ||
    !isSearched.value ||
    id === undefined ||
    seenDatasets.has(id)
  )
    return;
  const { datasets } = await $fetch("/api/datasets", {
    query: { ids: String(id) },
  });
  for (const item of datasetSubjectItems(datasets)) {
    seenDatasets.set(item.value, item);
  }
};
onMounted(rememberPrefilledDataset);

const datasetItems = computed(() => {
  const found = datasetSubjectItems(datasetResults.value);
  for (const item of found) seenDatasets.set(item.value, item);
  const selected =
    subjectId.value === undefined
      ? undefined
      : seenDatasets.get(subjectId.value);
  return selected && !found.some((item) => item.value === selected.value)
    ? [selected, ...found]
    : found;
});

const subjectItems = computed(() =>
  isSearched.value ? datasetItems.value : listedItems.value,
);
const subjectItemsLoading = computed(() =>
  isSearched.value
    ? datasetsLoading.value
    : listedItemsStatus.value === "pending",
);

watch(subjectType, () => {
  subjectId.value = undefined;
  searchTerm.value = "";
});

const save = async () => {
  saving.value = true;
  try {
    await $fetch("/api/diary", {
      method: "POST",
      body: {
        subjectType: subjectType.value,
        subjectId: needsSubjectId.value ? (subjectId.value ?? null) : null,
        title: title.value,
        body: body.value,
      },
    });
    toast.add({ title: "Diary entry added", color: "success" });
    title.value = "";
    body.value = "";
    emit("saved");
  } catch {
    toast.add({ title: "Could not add the diary entry", color: "error" });
  } finally {
    saving.value = false;
  }
};
</script>

<template>
  <form class="flex flex-col gap-4" @submit.prevent="save">
    <div v-if="!fixedSubject" class="flex gap-3">
      <UFormField label="Subject type" name="subjectType" class="flex-1">
        <USelect
          v-model="subjectType"
          :items="subjectTypeItems"
          :icon="DIARY_SUBJECT_ICON[subjectType]"
          class="w-full"
        />
      </UFormField>
      <UFormField
        v-if="needsSubjectId"
        label="Subject"
        name="subjectId"
        class="flex-[2]"
      >
        <USelectMenu
          v-model="subjectId"
          v-model:search-term="searchTerm"
          :items="subjectItems"
          value-key="value"
          :ignore-filter="isSearched"
          :loading="subjectItemsLoading"
          :placeholder="`Choose a ${subjectType}`"
          class="w-full"
          data-testid="subject-picker"
        >
          <template v-if="isSearched && !searchTerm.trim()" #empty>
            Type part of a dataset name to search.
          </template>
        </USelectMenu>
      </UFormField>
    </div>

    <UFormField label="Title" name="title" required>
      <UInput v-model="title" class="w-full" maxlength="200" />
    </UFormField>

    <UFormField label="Body" name="body" description="Markdown.">
      <UTextarea v-model="body" class="w-full" :rows="8" />
    </UFormField>

    <UButton
      type="submit"
      color="primary"
      label="Add entry"
      :loading="saving"
      :disabled="!title.trim()"
      class="self-start"
    />
  </form>
</template>

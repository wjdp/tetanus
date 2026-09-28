<script setup lang="ts">
import { getPageTitle } from "#shared/app";
import {
  DIARY_ENTRY_KINDS,
  DIARY_SUBJECT_TYPES,
  type DiarySubjectType,
} from "#shared/diary";

useSeoMeta({ title: getPageTitle("Diary") });

const ALL = "all";
const DIARY_LIMIT = 200;

const route = useRoute();

const subjectFilter = ref<string>(ALL);
const kindFilter = ref<string>(ALL);

const query = computed(() => ({
  limit: DIARY_LIMIT,
  ...(subjectFilter.value === ALL ? {} : { subjectType: subjectFilter.value }),
}));

const { data: entries, refresh } = await useFetch("/api/diary", { query });
const { data: disks } = await useFetch("/api/disks", { lazy: true });
const { data: pools } = await useFetch("/api/pools", { lazy: true });

const visibleEntries = computed(() =>
  (entries.value ?? []).filter(
    (entry) => kindFilter.value === ALL || entry.kind === kindFilter.value,
  ),
);

const subjectLabel = (subjectType: DiarySubjectType, id: number) => {
  if (subjectType === "disk") {
    const alias = disks.value?.find((row) => row.id === id)?.alias;
    return alias ? `disk ${alias}` : `disk ${id}`;
  }
  if (subjectType === "pool") {
    const name = pools.value?.find((row) => row.id === id)?.name;
    return name ? `pool ${name}` : `pool ${id}`;
  }
  return `${subjectType} ${id}`;
};

const subjectItems = [
  { label: "All subjects", value: ALL },
  ...DIARY_SUBJECT_TYPES.map((value) => ({ label: value, value })),
];
const kindItems = [
  { label: "All kinds", value: ALL },
  ...DIARY_ENTRY_KINDS.map((value) => ({ label: value, value })),
];

const isSubjectType = (value: unknown): value is DiarySubjectType =>
  DIARY_SUBJECT_TYPES.includes(value as DiarySubjectType);

const prefillType = isSubjectType(route.query.subjectType)
  ? route.query.subjectType
  : undefined;
const prefillIdNumber = Number(route.query.subjectId);
const prefillId =
  Number.isInteger(prefillIdNumber) && prefillIdNumber > 0
    ? prefillIdNumber
    : undefined;

const editorOpen = ref(prefillType !== undefined && prefillId !== undefined);

const onSaved = async () => {
  editorOpen.value = false;
  await refresh();
};
</script>

<template>
  <AppPanel title="Diary" class="flex max-w-4xl flex-col gap-6">
    <div class="flex items-center justify-between gap-4">
      <h1 class="text-highlighted text-2xl font-semibold tracking-tight">
        Diary
      </h1>
      <UButton
        color="primary"
        icon="i-lucide-plus"
        label="New entry"
        @click="editorOpen = true"
      />
    </div>

    <div class="flex flex-wrap gap-2">
      <USelect
        v-model="subjectFilter"
        :items="subjectItems"
        class="w-40"
        aria-label="Filter by subject"
      />
      <USelect
        v-model="kindFilter"
        :items="kindItems"
        class="w-36"
        aria-label="Filter by kind"
      />
    </div>

    <DiaryTimeline
      :entries="visibleEntries"
      :subject-label="subjectLabel"
      empty="Nothing in the diary matches these filters."
    />
  </AppPanel>

  <USlideover v-model:open="editorOpen" title="New diary entry">
    <template #body>
      <DiaryEntryForm
        :subject-type="prefillType"
        :subject-id="prefillId"
        @saved="onSaved"
      />
    </template>
  </USlideover>
</template>

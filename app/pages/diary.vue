<script setup lang="ts">
import { getPageTitle } from "#shared/app";
import {
  DIARY_ENTRY_KINDS,
  DIARY_SUBJECT_TYPES,
  type DiaryEntryKind,
  type DiarySubjectType,
} from "#shared/diary";

useSeoMeta({ title: getPageTitle("Diary") });

const ALL = "all";

const route = useRoute();

const subjectFilter = ref<string>(ALL);
const kindFilter = ref<string>(ALL);

const filters = computed(() => ({
  subjectType:
    subjectFilter.value === ALL
      ? undefined
      : (subjectFilter.value as DiarySubjectType),
  kind:
    kindFilter.value === ALL ? undefined : (kindFilter.value as DiaryEntryKind),
}));

const diary = useInfiniteList((page) =>
  $fetch("/api/diary", { query: { ...page, ...filters.value } }),
);
const { items: entries, status } = diary;
watch(filters, diary.reload);

const subjectItems = [
  { label: "All subjects", value: ALL },
  ...DIARY_SUBJECT_TYPES.map((value) => ({
    label: value,
    value,
    icon: DIARY_SUBJECT_ICON[value],
  })),
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
  await diary.refresh();
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

    <div class="flex flex-col">
      <DiaryTimeline
        :entries="entries"
        :empty="
          status === 'success' ? 'Nothing in the diary matches these filters.' : ''
        "
        @changed="diary.refresh"
      />
      <InfiniteListEnd :list="diary" />
    </div>
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

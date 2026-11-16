<script setup lang="ts">
import type { DiaryEntryKind } from "#shared/diary";

const props = defineProps<{ diskId: number }>();
const emit = defineEmits<{ changed: [] }>();

type KindFilter = "all" | DiaryEntryKind;
const kindFilter = ref<KindFilter>("all");
const kindItems: { label: string; value: KindFilter }[] = [
  { label: "All", value: "all" },
  { label: "Manual", value: "manual" },
  { label: "Auto", value: "auto" },
];

const diary = useInfiniteList((page) =>
  $fetch("/api/diary", {
    query: {
      ...page,
      subjectType: "disk",
      subjectId: props.diskId,
      kind: kindFilter.value === "all" ? undefined : kindFilter.value,
    },
  }),
);
const { items: entries, status } = diary;
watch([kindFilter, () => props.diskId], diary.reload);

const formOpen = ref(false);

const refreshAfterChange = async () => {
  await diary.refresh();
  emit("changed");
};

const onSaved = async () => {
  formOpen.value = false;
  await refreshAfterChange();
};
</script>

<template>
  <section class="flex flex-col gap-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <UButton
        color="neutral"
        variant="soft"
        icon="i-lucide-plus"
        label="Add entry"
        data-testid="add-entry"
        @click="formOpen = !formOpen"
      />
      <UTabs
        v-model="kindFilter"
        :items="kindItems"
        :content="false"
        size="xs"
        color="neutral"
        variant="pill"
        aria-label="Filter by kind"
      />
    </div>

    <div
      v-if="formOpen"
      class="border-default flex flex-col gap-2 rounded-md border p-4"
      data-testid="diary-entry-form"
    >
      <DiaryEntryForm
        subject-type="disk"
        :subject-id="diskId"
        fixed-subject
        @saved="onSaved"
      />
      <UButton
        color="neutral"
        variant="ghost"
        label="Cancel"
        class="self-start"
        @click="formOpen = false"
      />
    </div>

    <div class="flex flex-col">
      <DiaryTimeline
        :entries="entries"
        :show-subject="false"
        :empty="status === 'success' ? 'Nothing recorded yet.' : ''"
        @changed="refreshAfterChange"
      />
      <InfiniteListEnd :list="diary" />
    </div>
  </section>
</template>

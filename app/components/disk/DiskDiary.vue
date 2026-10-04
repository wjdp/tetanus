<script setup lang="ts">
import type { DiaryEntryKind } from "#shared/diary";

const props = defineProps<{ diskId: number }>();
const emit = defineEmits<{ changed: [] }>();

const FIRST_PAGE = 20;
const PAGE_GROWTH = 50;

const limit = ref(FIRST_PAGE);
const query = computed(() => ({
  subjectType: "disk",
  subjectId: props.diskId,
  limit: limit.value,
}));

const {
  data: entries,
  status,
  refresh,
} = useFetch("/api/diary", { query, server: false, lazy: true });

type KindFilter = "all" | DiaryEntryKind;
const kindFilter = ref<KindFilter>("all");
const kindItems: { label: string; value: KindFilter }[] = [
  { label: "All", value: "all" },
  { label: "Manual", value: "manual" },
  { label: "Auto", value: "auto" },
];

const visibleEntries = computed(() =>
  (entries.value ?? []).filter(
    (entry) => kindFilter.value === "all" || entry.kind === kindFilter.value,
  ),
);

const hasOlder = computed(
  () => (entries.value?.length ?? 0) === limit.value,
);

const showOlder = () => {
  limit.value += PAGE_GROWTH;
};

const formOpen = ref(false);

const refreshAfterChange = async () => {
  await refresh();
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

    <DiaryTimeline
      :entries="visibleEntries"
      :show-subject="false"
      :empty="
        status === 'pending' && !entries ? 'Loading…' : 'Nothing recorded yet.'
      "
      @changed="refreshAfterChange"
    />

    <UButton
      v-if="hasOlder"
      color="neutral"
      variant="ghost"
      icon="i-lucide-chevron-down"
      label="Show older"
      :loading="status === 'pending'"
      class="self-start"
      data-testid="show-older"
      @click="showOlder"
    />
  </section>
</template>

<script setup lang="ts">
import type { DiaryEntryKind, DiarySubjectType } from "#shared/diary";

interface TimelineEntry {
  id: number;
  subjectType: DiarySubjectType;
  subjectId: number | null;
  at: string | Date;
  kind: DiaryEntryKind;
  eventType: string | null;
  data?: unknown;
  title: string;
  body: string;
  subjectLabel: string | null;
  subjectPath: string | null;
}

const props = withDefaults(
  defineProps<{
    entries: TimelineEntry[];
    empty?: string;
    showSubject?: boolean;
  }>(),
  {
    empty: "No diary entries yet.",
    showSubject: true,
  },
);

const emit = defineEmits<{ changed: [] }>();

const toast = useToast();
const editing = ref<TimelineEntry | null>(null);
const editOpen = ref(false);
const deleting = ref<TimelineEntry | null>(null);
const deleteOpen = ref(false);

const startEdit = (entry: TimelineEntry) => {
  editing.value = entry;
  editOpen.value = true;
};

const startDelete = (entry: TimelineEntry) => {
  deleting.value = entry;
  deleteOpen.value = true;
};

const onSaved = () => {
  editOpen.value = false;
  emit("changed");
};

const deleteEntry = async () => {
  const entry = deleting.value;
  if (!entry) return;
  try {
    await $fetch(`/api/diary/${entry.id}`, { method: "DELETE" });
    toast.add({ title: "Diary entry deleted", color: "neutral" });
    emit("changed");
  } catch {
    toast.add({ title: "Could not delete the diary entry", color: "error" });
  }
};

const isoOf = (at: string | Date) =>
  (typeof at === "string" ? new Date(at) : at).toISOString();

const newestFirst = computed(() =>
  [...props.entries].sort((a, b) => isoOf(b.at).localeCompare(isoOf(a.at))),
);

const days = computed(() => {
  const groups: { day: string; entries: TimelineEntry[] }[] = [];
  for (const entry of newestFirst.value) {
    const day = isoOf(entry.at).slice(0, 10);
    const last = groups.at(-1);
    if (last?.day === day) last.entries.push(entry);
    else groups.push({ day, entries: [entry] });
  }
  return groups;
});

const timeOf = (at: string | Date) => isoOf(at).slice(11, 16);

</script>

<template>
  <p v-if="entries.length === 0" class="text-muted text-sm">{{ empty }}</p>

  <ol v-else class="flex flex-col gap-6" data-testid="diary-timeline">
    <li v-for="group in days" :key="group.day" class="flex flex-col gap-2">
      <h3 class="text-muted text-sm font-semibold tabular-nums">
        {{ group.day }}
      </h3>
      <ul class="border-default ml-2 flex flex-col gap-3 border-l pl-5">
        <li
          v-for="entry in group.entries"
          :key="entry.id"
          class="relative flex flex-col gap-1"
          data-testid="diary-entry"
        >
          <span
            class="bg-default absolute top-0.5 -left-5 flex size-4 -translate-x-1/2 items-center justify-center"
            data-testid="diary-entry-icon"
          >
            <DiaryEventIcon
              :event-type="entry.eventType"
              :data="entry.data"
              :manual="entry.kind === 'manual'"
            />
          </span>
          <div class="flex flex-wrap items-center gap-2 text-sm">
            <span class="text-dimmed font-mono text-xs tabular-nums">
              {{ timeOf(entry.at) }}
            </span>
            <UBadge
              color="neutral"
              :variant="entry.kind === 'manual' ? 'outline' : 'soft'"
              size="sm"
              :class="entry.kind === 'auto' ? 'text-muted' : ''"
            >
              {{ entry.kind }}
            </UBadge>
            <span
              v-if="entry.eventType"
              class="bg-elevated text-muted rounded px-1.5 py-0.5 font-mono text-xs"
            >
              {{ entry.eventType }}
            </span>
            <template v-if="showSubject">
              <NuxtLink
                v-if="entry.subjectPath"
                :to="entry.subjectPath"
                class="text-muted hover:text-primary inline-flex items-center gap-1"
              >
                <UIcon
                  :name="DIARY_SUBJECT_ICON[entry.subjectType]"
                  class="size-3.5"
                />
                {{ entry.subjectLabel }}
              </NuxtLink>
              <span v-else class="text-muted">{{ entry.subjectType }}</span>
            </template>
            <div
              v-if="entry.kind === 'manual'"
              class="ml-auto flex gap-1"
              data-testid="diary-entry-actions"
            >
              <UButton
                color="neutral"
                variant="ghost"
                size="xs"
                icon="i-lucide-pencil"
                aria-label="Edit entry"
                @click="startEdit(entry)"
              />
              <UButton
                color="neutral"
                variant="ghost"
                size="xs"
                icon="i-lucide-trash-2"
                aria-label="Delete entry"
                @click="startDelete(entry)"
              />
            </div>
          </div>
          <p class="text-highlighted font-medium">{{ entry.title }}</p>
          <DiaryMarkdown v-if="entry.body.trim()" :source="entry.body" />
        </li>
      </ul>
    </li>
  </ol>

  <USlideover v-model:open="editOpen" title="Edit diary entry">
    <template #body>
      <DiaryEntryEditForm
        v-if="editing"
        :key="editing.id"
        :entry="editing"
        @saved="onSaved"
      />
    </template>
  </USlideover>

  <ConfirmModal
    v-model:open="deleteOpen"
    :title="`Delete “${deleting?.title ?? ''}”?`"
    description="The diary entry is removed permanently."
    confirm-label="Delete"
    :action="deleteEntry"
  />
</template>

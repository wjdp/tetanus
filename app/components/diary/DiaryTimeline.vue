<script setup lang="ts">
import type { DiaryEntryKind, DiarySubjectType } from "#shared/diary";

interface TimelineEntry {
  id: number;
  subjectType: DiarySubjectType;
  subjectId: number | null;
  at: string | Date;
  kind: DiaryEntryKind;
  eventType: string | null;
  title: string;
  body: string;
}

const props = withDefaults(
  defineProps<{
    entries: TimelineEntry[];
    subjectLabel?: (subjectType: DiarySubjectType, id: number) => string;
    empty?: string;
    showSubject?: boolean;
  }>(),
  {
    subjectLabel: (subjectType: DiarySubjectType, id: number) =>
      `${subjectType} ${id}`,
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

const subjectLink = (entry: TimelineEntry) => {
  if (entry.subjectId === null) return null;
  switch (entry.subjectType) {
    case "disk":
      return `/disks/${entry.subjectId}`;
    case "pool":
      return `/zfs/${entry.subjectId}`;
    case "dataset":
      return `/datasets/${entry.subjectId}`;
    case "host":
      return "/settings/hosts";
    default:
      return null;
  }
};
</script>

<template>
  <p v-if="entries.length === 0" class="text-muted text-sm">{{ empty }}</p>

  <ol v-else class="flex flex-col gap-6" data-testid="diary-timeline">
    <li v-for="group in days" :key="group.day" class="flex flex-col gap-2">
      <h3 class="text-muted text-sm font-semibold tabular-nums">
        {{ group.day }}
      </h3>
      <ul class="border-default flex flex-col gap-3 border-l pl-4">
        <li
          v-for="entry in group.entries"
          :key="entry.id"
          class="flex flex-col gap-1"
          data-testid="diary-entry"
        >
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
                v-if="entry.subjectId !== null && subjectLink(entry)"
                :to="subjectLink(entry) ?? undefined"
                class="text-muted hover:text-primary"
              >
                {{ subjectLabel(entry.subjectType, entry.subjectId) }}
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

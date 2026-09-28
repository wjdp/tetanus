<script setup lang="ts">
import type { DiaryEntry } from "./types";

const props = defineProps<{ diskId: number; entries: DiaryEntry[] }>();
const emit = defineEmits<{ added: [] }>();

const toast = useToast();
const title = ref("");
const body = ref("");
const saving = ref(false);
const now = ref(Date.now());

const newestFirst = computed(() =>
  [...props.entries].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)),
);

const relativeTime = (at: string) =>
  `${formatDuration(Math.max(0, now.value - Date.parse(at)))} ago`;

const addEntry = async () => {
  saving.value = true;
  try {
    await $fetch("/api/diary", {
      method: "POST",
      body: {
        subjectType: "disk",
        subjectId: props.diskId,
        title: title.value,
        body: body.value,
      },
    });
    title.value = "";
    body.value = "";
    now.value = Date.now();
    emit("added");
  } catch {
    toast.add({ title: "Could not add the diary entry", color: "error" });
  } finally {
    saving.value = false;
  }
};
</script>

<template>
  <section class="flex flex-col gap-4">
    <h2 class="text-highlighted text-lg font-semibold">Diary</h2>

    <form class="flex flex-col gap-2" @submit.prevent="addEntry">
      <UInput
        v-model="title"
        placeholder="What happened?"
        aria-label="Entry title"
        class="w-full"
        required
        maxlength="200"
      />
      <UTextarea
        v-model="body"
        placeholder="Details (optional)"
        aria-label="Entry details"
        :rows="2"
        autoresize
        class="w-full"
      />
      <UButton
        type="submit"
        color="neutral"
        variant="soft"
        label="Add entry"
        :loading="saving"
        :disabled="!title.trim()"
        class="self-start"
      />
    </form>

    <p v-if="newestFirst.length === 0" class="text-muted text-sm">
      Nothing recorded yet.
    </p>
    <ol v-else class="flex flex-col">
      <li
        v-for="entry in newestFirst"
        :key="entry.id"
        class="border-default flex flex-col gap-1 border-b py-3 last:border-b-0"
      >
        <div class="flex flex-wrap items-center gap-2 text-sm">
          <UBadge
            color="neutral"
            :variant="entry.kind === 'auto' ? 'outline' : 'subtle'"
            size="sm"
            :label="entry.kind"
            :class="entry.kind === 'auto' ? 'text-dimmed' : ''"
          />
          <span v-if="entry.eventType" class="text-dimmed font-mono text-xs">
            {{ entry.eventType }}
          </span>
          <span
            :class="entry.kind === 'auto' ? 'text-muted' : 'text-highlighted'"
          >
            {{ entry.title }}
          </span>
          <time
            :datetime="entry.at"
            :title="entry.at"
            class="text-dimmed ml-auto text-xs"
          >
            {{ relativeTime(entry.at) }}
          </time>
        </div>
        <p
          v-if="entry.body"
          class="text-muted text-sm whitespace-pre-line"
        >
          {{ entry.body }}
        </p>
      </li>
    </ol>
  </section>
</template>

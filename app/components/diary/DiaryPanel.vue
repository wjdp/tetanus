<script setup lang="ts">
import type { DiarySubjectType } from "#shared/diary";
import type { DiaryEntry } from "~/components/disk/types";

const props = withDefaults(
  defineProps<{
    subjectType: DiarySubjectType;
    subjectId: number;
    entries: DiaryEntry[];
    showHeading?: boolean;
  }>(),
  { showHeading: true },
);
const emit = defineEmits<{ changed: [] }>();

const toast = useToast();
const title = ref("");
const body = ref("");
const saving = ref(false);

const addEntry = async () => {
  saving.value = true;
  try {
    await $fetch("/api/diary", {
      method: "POST",
      body: {
        subjectType: props.subjectType,
        subjectId: props.subjectId,
        title: title.value,
        body: body.value,
      },
    });
    title.value = "";
    body.value = "";
    emit("changed");
  } catch {
    toast.add({ title: "Could not add the diary entry", color: "error" });
  } finally {
    saving.value = false;
  }
};
</script>

<template>
  <section class="flex flex-col gap-4">
    <h2 v-if="showHeading" class="text-highlighted text-lg font-semibold">
      Diary
    </h2>

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
        placeholder="Details, markdown (optional)"
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

    <DiaryTimeline
      :entries="entries"
      :show-subject="false"
      empty="Nothing recorded yet."
      @changed="emit('changed')"
    />
  </section>
</template>

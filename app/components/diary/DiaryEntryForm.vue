<script setup lang="ts">
import { DIARY_SUBJECT_TYPES, type DiarySubjectType } from "#shared/diary";

const props = defineProps<{
  subjectType?: DiarySubjectType;
  subjectId?: number | null;
}>();

const emit = defineEmits<{ saved: [] }>();

const subjectType = ref<DiarySubjectType>(props.subjectType ?? "disk");
const subjectId = ref<number | undefined>(props.subjectId ?? undefined);
const title = ref("");
const body = ref("");
const saving = ref(false);
const toast = useToast();

const needsSubjectId = computed(() => subjectType.value !== "system");

const { data: subjectItems, status: subjectItemsStatus } = useLazyAsyncData(
  () => `diary-subject-items:${subjectType.value}`,
  () => fetchSubjectItems(subjectType.value),
  { server: false, default: () => [] },
);

watch(subjectType, () => {
  subjectId.value = undefined;
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
    <div class="flex gap-3">
      <UFormField label="Subject type" name="subjectType" class="flex-1">
        <USelect
          v-model="subjectType"
          :items="[...DIARY_SUBJECT_TYPES]"
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
          :items="subjectItems"
          value-key="value"
          :loading="subjectItemsStatus === 'pending'"
          :placeholder="`Choose a ${subjectType}`"
          class="w-full"
          data-testid="subject-picker"
        />
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

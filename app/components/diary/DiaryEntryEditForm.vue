<script setup lang="ts">
export interface EditableEntry {
  id: number;
  at: string | Date;
  title: string;
  body: string;
}

const props = defineProps<{ entry: EditableEntry }>();
const emit = defineEmits<{ saved: [] }>();

const toast = useToast();
const saving = ref(false);

const toUtcInput = (at: string | Date) =>
  (typeof at === "string" ? new Date(at) : at).toISOString().slice(0, 16);

const title = ref(props.entry.title);
const body = ref(props.entry.body);
const at = ref(toUtcInput(props.entry.at));

const save = async () => {
  saving.value = true;
  try {
    await $fetch(`/api/diary/${props.entry.id}`, {
      method: "PATCH",
      body: {
        title: title.value,
        body: body.value,
        at: new Date(`${at.value}:00Z`).toISOString(),
      },
    });
    toast.add({ title: "Diary entry saved", color: "neutral" });
    emit("saved");
  } catch {
    toast.add({ title: "Could not save the diary entry", color: "error" });
  } finally {
    saving.value = false;
  }
};
</script>

<template>
  <form class="flex flex-col gap-4" @submit.prevent="save">
    <UFormField label="Title" name="title" required>
      <UInput v-model="title" class="w-full" maxlength="200" />
    </UFormField>

    <UFormField label="When (UTC)" name="at" required>
      <UInput v-model="at" type="datetime-local" class="w-full" required />
    </UFormField>

    <UFormField label="Body" name="body" description="Markdown.">
      <UTextarea v-model="body" class="w-full" :rows="8" autoresize />
    </UFormField>

    <UButton
      type="submit"
      color="primary"
      label="Save"
      :loading="saving"
      :disabled="!title.trim() || !at"
      class="self-start"
    />
  </form>
</template>

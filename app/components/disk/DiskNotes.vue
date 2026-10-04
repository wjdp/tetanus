<script setup lang="ts">
import type { DiskDetail } from "./types";
import { useDiskFieldSave } from "./useDiskFieldSave";

const props = defineProps<{ disk: DiskDetail }>();
const emit = defineEmits<{ updated: [disk: DiskDetail] }>();

const { saving, errors, save } = useDiskFieldSave(
  () => props.disk.id,
  (disk) => emit("updated", disk),
);

const editing = ref(false);
const draft = ref("");

const startEdit = () => {
  draft.value = props.disk.notes;
  errors.notes = null;
  editing.value = true;
};

const submit = async () => {
  await save("notes", { notes: draft.value });
  if (!errors.notes) editing.value = false;
};
</script>

<template>
  <section
    class="border-default flex min-w-0 break-inside-avoid flex-col gap-3 rounded-lg border p-4"
    data-testid="disk-notes"
  >
    <div class="flex min-h-7 items-center justify-between gap-2">
      <h2 class="text-highlighted font-semibold">Notes</h2>
      <UButton
        v-if="!editing"
        size="xs"
        color="neutral"
        variant="ghost"
        icon="i-lucide-pencil"
        label="Edit"
        data-testid="notes-edit"
        @click="startEdit"
      />
    </div>

    <form v-if="editing" class="flex flex-col gap-2" @submit.prevent="submit">
      <UTextarea
        v-model="draft"
        class="w-full"
        :rows="4"
        autoresize
        aria-label="Notes"
      />
      <p v-if="errors.notes" class="text-error text-xs" role="alert">
        {{ errors.notes }}
      </p>
      <div class="flex gap-2">
        <UButton
          type="submit"
          size="sm"
          label="Save"
          :loading="saving.notes"
          data-testid="notes-save"
        />
        <UButton
          size="sm"
          color="neutral"
          variant="ghost"
          label="Cancel"
          data-testid="notes-cancel"
          @click="editing = false"
        />
      </div>
    </form>
    <DiaryMarkdown v-else-if="disk.notes.trim()" :source="disk.notes" />
    <p v-else class="text-dimmed text-sm">No notes</p>
  </section>
</template>

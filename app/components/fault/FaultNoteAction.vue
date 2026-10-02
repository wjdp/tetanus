<script setup lang="ts">
const props = defineProps<{
  label: string;
  placeholder: string;
  confirm: (note: string) => Promise<void>;
}>();

const open = ref(false);
const note = ref("");
const saving = ref(false);

watch(open, (isOpen) => {
  if (isOpen) note.value = "";
});

const submit = async () => {
  saving.value = true;
  try {
    await props.confirm(note.value.trim());
    open.value = false;
  } finally {
    saving.value = false;
  }
};
</script>

<template>
  <UPopover v-model:open="open">
    <UButton color="neutral" variant="soft" size="xs" :label="label" />

    <template #content>
      <form
        class="flex w-72 flex-col gap-2 p-3"
        :aria-label="label"
        @submit.prevent="submit"
      >
        <UTextarea
          v-model="note"
          :rows="2"
          autoresize
          :placeholder="placeholder"
          aria-label="Note"
          class="w-full"
        />
        <div class="flex justify-end gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            size="xs"
            label="Cancel"
            @click="open = false"
          />
          <UButton type="submit" size="xs" :label="label" :loading="saving" />
        </div>
      </form>
    </template>
  </UPopover>
</template>

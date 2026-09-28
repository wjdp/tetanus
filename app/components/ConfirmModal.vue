<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    title: string;
    description?: string;
    confirmLabel?: string;
    action: () => Promise<void>;
  }>(),
  { description: undefined, confirmLabel: "Confirm" },
);

const open = defineModel<boolean>("open", { default: false });
const running = ref(false);

const confirm = async () => {
  running.value = true;
  try {
    await props.action();
    open.value = false;
  } finally {
    running.value = false;
  }
};
</script>

<template>
  <UModal v-model:open="open" :title="title" :description="description">
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton color="neutral" variant="ghost" label="Cancel" @click="open = false" />
        <UButton
          color="primary"
          :label="confirmLabel"
          :loading="running"
          data-testid="confirm-action"
          @click="confirm"
        />
      </div>
    </template>
  </UModal>
</template>

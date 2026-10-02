<script setup lang="ts">
import {
  POOL_CONFIG_DEFAULTS,
  type ResolvedPoolConfig,
} from "#shared/schemas/pools";

const props = defineProps<{ poolId: number; config: ResolvedPoolConfig }>();
const emit = defineEmits<{ saved: [] }>();

const open = ref(false);
const saving = ref(false);
const draft = reactive<ResolvedPoolConfig>({ ...props.config });
const toast = useToast();

watch(open, (isOpen) => {
  if (isOpen) Object.assign(draft, props.config);
});

const FIELDS = [
  {
    key: "scrubIntervalDays",
    label: "Scrub interval (days)",
    description: `Scrub overdue after this many days. 0 disables. Default ${POOL_CONFIG_DEFAULTS.scrubIntervalDays}.`,
  },
  {
    key: "slowIoThreshold",
    label: "Slow I/O threshold (per 24 h)",
    description: `A leaf gaining this many slow I/Os in 24 h is a fault. 0 disables. Default ${POOL_CONFIG_DEFAULTS.slowIoThreshold}.`,
  },
] as const satisfies {
  key: keyof ResolvedPoolConfig;
  label: string;
  description: string;
}[];

const save = async () => {
  saving.value = true;
  try {
    await $fetch(`/api/pools/${props.poolId}/config`, {
      method: "PATCH",
      body: { ...draft },
    });
    open.value = false;
    emit("saved");
  } catch {
    toast.add({ title: "Could not save the pool settings", color: "error" });
  } finally {
    saving.value = false;
  }
};
</script>

<template>
  <UPopover v-model:open="open" :content="{ align: 'end' }">
    <UButton
      color="neutral"
      variant="ghost"
      size="sm"
      icon="i-lucide-settings-2"
      aria-label="Pool settings"
      data-testid="pool-config"
    />
    <template #content>
      <form
        class="flex w-72 flex-col gap-3 p-4"
        data-testid="pool-config-form"
        @submit.prevent="save"
      >
        <UFormField
          v-for="field in FIELDS"
          :key="field.key"
          :label="field.label"
          :name="field.key"
          :description="field.description"
        >
          <UInput
            v-model.number="draft[field.key]"
            type="number"
            min="0"
            step="1"
            required
            class="w-full"
          />
        </UFormField>
        <UButton
          type="submit"
          color="primary"
          :loading="saving"
          label="Save"
          class="self-start"
        />
      </form>
    </template>
  </UPopover>
</template>

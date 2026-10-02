<script setup lang="ts">
import {
  POOL_CONFIG_DEFAULTS,
  type PoolConfig,
  type PoolConfigPatch,
  type ResolvedPoolConfig,
} from "#shared/schemas/pools";

type ConfigKey = keyof ResolvedPoolConfig;

const props = defineProps<{ poolId: number; config: PoolConfig | null }>();
const emit = defineEmits<{ saved: [] }>();

const open = ref(false);
const saving = ref(false);
// An empty input is the default; `v-model.number` leaves it as "".
const draft = reactive<Record<ConfigKey, number | "">>({
  scrubIntervalDays: "",
  slowIoThreshold: "",
});
const toast = useToast();

const fillDraft = () => {
  draft.scrubIntervalDays = props.config?.scrubIntervalDays ?? "";
  draft.slowIoThreshold = props.config?.slowIoThreshold ?? "";
};

watch(open, (isOpen) => {
  if (isOpen) fillDraft();
});

const FIELDS = [
  {
    key: "scrubIntervalDays",
    label: "Scrub interval (days)",
    description: "Scrub overdue after this many days. 0 disables.",
  },
  {
    key: "slowIoThreshold",
    label: "Slow I/O threshold (per 24 h)",
    description:
      "A leaf gaining this many slow I/Os in 24 h is a fault. 0 disables.",
  },
] as const satisfies {
  key: ConfigKey;
  label: string;
  description: string;
}[];

const isDefault = (key: ConfigKey) => draft[key] === "";

const patchValue = (key: ConfigKey) =>
  isDefault(key) ? null : Number(draft[key]);

const save = async () => {
  saving.value = true;
  try {
    const body: PoolConfigPatch = {
      scrubIntervalDays: patchValue("scrubIntervalDays"),
      slowIoThreshold: patchValue("slowIoThreshold"),
    };
    await $fetch(`/api/pools/${props.poolId}/config`, {
      method: "PATCH",
      body,
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
            :placeholder="`Default (${POOL_CONFIG_DEFAULTS[field.key]})`"
            class="w-full"
            :ui="{ trailing: 'pe-1' }"
          >
            <template v-if="!isDefault(field.key)" #trailing>
              <UButton
                color="neutral"
                variant="link"
                size="xs"
                icon="i-lucide-rotate-ccw"
                :aria-label="`Use the default ${field.label.toLowerCase()}`"
                title="Use default"
                :data-testid="`pool-config-default-${field.key}`"
                @click="draft[field.key] = ''"
              />
            </template>
          </UInput>
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

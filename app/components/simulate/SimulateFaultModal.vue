<script setup lang="ts">
import type {
  ScenarioView,
  SimulationParams,
  SimulationParamValue,
} from "#shared/simulator";

const props = defineProps<{
  scenario: ScenarioView;
  run: (params: SimulationParams) => Promise<void>;
}>();

const open = defineModel<boolean>("open", { default: false });

const defaults = () =>
  Object.fromEntries(
    props.scenario.params.map((param) => [param.key, param.default]),
  ) as Record<string, SimulationParamValue>;

const values = ref(defaults());
const running = ref(false);

watch([open, () => props.scenario], ([isOpen]) => {
  if (isOpen) values.value = defaults();
});

const set = (key: string, value: SimulationParamValue) => {
  values.value[key] = value;
};

const submit = async () => {
  running.value = true;
  try {
    await props.run({ ...values.value });
    open.value = false;
  } finally {
    running.value = false;
  }
};
</script>

<template>
  <UModal
    v-model:open="open"
    :title="`Simulate: ${scenario.label}`"
    :description="scenario.description"
  >
    <template #body>
      <form
        id="simulate-fault-form"
        class="flex flex-col gap-4"
        :aria-label="`Simulate ${scenario.label}`"
        @submit.prevent="submit"
      >
        <UFormField
          v-for="param in scenario.params"
          :key="param.key"
          :label="param.label"
          :hint="param.kind === 'number' ? param.unit : undefined"
        >
          <UInputNumber
            v-if="param.kind === 'number'"
            :model-value="Number(values[param.key])"
            :min="param.min"
            :max="param.max"
            class="w-full"
            @update:model-value="(value) => set(param.key, value ?? param.default)"
          />
          <USelect
            v-else
            :model-value="String(values[param.key])"
            :items="param.options"
            value-key="value"
            label-key="label"
            class="w-full"
            @update:model-value="(value) => set(param.key, String(value))"
          />
        </UFormField>
      </form>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton
          color="neutral"
          variant="ghost"
          label="Cancel"
          @click="open = false"
        />
        <UButton
          type="submit"
          form="simulate-fault-form"
          icon="i-lucide-flask-conical"
          label="Simulate"
          :loading="running"
        />
      </div>
    </template>
  </UModal>
</template>

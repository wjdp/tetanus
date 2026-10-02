<script setup lang="ts">
import type { DropdownMenuItem } from "@nuxt/ui";
import type {
  ScenarioView,
  SimulationParams,
  SimulationSubjectType,
  SubjectScenarios,
} from "#shared/simulator";

const props = withDefaults(
  defineProps<{
    subjectType: SimulationSubjectType;
    subjectId: number;
    size?: "xs" | "sm" | "md";
    compact?: boolean;
  }>(),
  { size: "md", compact: false },
);

const { enabled, simulations, simulate, restore } = useSimulator();
const toast = useToast();

const scenarios = ref<ScenarioView[] | null>(null);
const busy = ref(false);
const configuring = ref<ScenarioView | null>(null);
const modalOpen = ref(false);

const loadScenarios = async () => {
  try {
    const response = await $fetch<SubjectScenarios>(
      `/api/simulate/${props.subjectType}/${props.subjectId}`,
    );
    scenarios.value = response.scenarios;
  } catch {
    scenarios.value = [];
    toast.add({ title: "Could not load the fault scenarios", color: "error" });
  }
};

const onOpen = (open: boolean) => {
  if (open) void loadScenarios();
};

const run = async (scenario: ScenarioView, params: SimulationParams = {}) => {
  busy.value = true;
  try {
    await simulate(props.subjectType, props.subjectId, scenario.id, params);
    toast.add({
      title: `Simulated: ${scenario.label}`,
      description: "Restore removes every trace.",
      icon: "i-lucide-flask-conical",
    });
  } catch {
    toast.add({ title: `Could not simulate ${scenario.label}`, color: "error" });
  } finally {
    busy.value = false;
  }
};

const choose = (scenario: ScenarioView) => {
  if (scenario.params.length === 0) {
    void run(scenario);
    return;
  }
  configuring.value = scenario;
  modalOpen.value = true;
};

const onRestore = async () => {
  busy.value = true;
  try {
    await restore();
    toast.add({ title: "Simulated faults removed", icon: "i-lucide-undo-2" });
  } catch {
    toast.add({ title: "Could not restore", color: "error" });
  } finally {
    busy.value = false;
  }
};

const items = computed<DropdownMenuItem[][]>(() => {
  if (scenarios.value === null) {
    return [[{ label: "Loading…", icon: "i-lucide-loader-circle", disabled: true }]];
  }
  const groups = new Map<string, DropdownMenuItem[]>();
  for (const scenario of scenarios.value) {
    const group = groups.get(scenario.group) ?? [
      { type: "label", label: scenario.group },
    ];
    group.push({
      label: scenario.params.length ? `${scenario.label}…` : scenario.label,
      onSelect: () => choose(scenario),
    });
    groups.set(scenario.group, group);
  }
  const sections = [...groups.values()];
  if (sections.length === 0) {
    sections.push([{ label: "Nothing to simulate here", disabled: true }]);
  }
  if (simulations.value.length) {
    sections.push([
      {
        label: `Restore (${simulations.value.length} simulated)`,
        icon: "i-lucide-undo-2",
        color: "warning",
        onSelect: onRestore,
      },
    ]);
  }
  return sections;
});
</script>

<template>
  <template v-if="enabled">
    <UDropdownMenu
      :items="items"
      :content="{ align: 'end' }"
      :ui="{ content: 'max-h-[70vh] min-w-56' }"
      @update:open="onOpen"
    >
      <UButton
        color="neutral"
        variant="outline"
        :size="size"
        icon="i-lucide-flask-conical"
        :label="compact ? undefined : 'Simulate fault'"
        :aria-label="compact ? 'Simulate fault' : undefined"
        :loading="busy"
        data-testid="simulate-fault"
      />
    </UDropdownMenu>
    <SimulateFaultModal
      v-if="configuring"
      v-model:open="modalOpen"
      :scenario="configuring"
      :run="(params) => run(configuring as ScenarioView, params)"
    />
  </template>
</template>

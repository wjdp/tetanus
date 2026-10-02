import {
  type SimulationParams,
  type SimulationSubjectType,
  type SimulatorStatus,
  simulatorEnabled,
} from "#shared/simulator";

export function useSimulator() {
  const { demo, faultSimulator } = useRuntimeConfig().public;
  const enabled = simulatorEnabled({
    dev: import.meta.dev,
    demo: demo === true,
    faultSimulator: faultSimulator === true,
  });
  const status = useState<SimulatorStatus>("simulator", () => ({
    simulations: [],
  }));
  const simulations = computed(() => status.value.simulations);

  const refresh = async () => {
    if (!enabled) return;
    status.value = await $fetch<SimulatorStatus>("/api/simulate");
  };

  const afterChange = async (next: SimulatorStatus) => {
    status.value = next;
    await refreshNuxtData();
  };

  const simulate = async (
    subjectType: SimulationSubjectType,
    subjectId: number,
    scenario: string,
    params: SimulationParams = {},
  ) =>
    afterChange(
      await $fetch<SimulatorStatus>(
        `/api/simulate/${subjectType}/${subjectId}`,
        { method: "POST", body: { scenario, params } },
      ),
    );

  const restore = async () =>
    afterChange(
      await $fetch<SimulatorStatus>("/api/simulate/restore", {
        method: "POST",
      }),
    );

  return { enabled, simulations, refresh, simulate, restore };
}

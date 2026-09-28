import type { Fault } from "#shared/faults";

export const useFaults = () => computed<Fault[]>(() => []);

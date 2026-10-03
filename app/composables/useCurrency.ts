import { DEFAULT_CURRENCY } from "#shared/money";

export function useCurrency() {
  const { data } = useSettings();
  return computed(() => data.value?.config.currency ?? DEFAULT_CURRENCY);
}

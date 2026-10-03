export function useSettings() {
  return useFetch("/api/settings", { key: "settings" });
}

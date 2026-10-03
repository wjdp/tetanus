export function useDiskList() {
  return useLazyFetch("/api/disks", { key: "disk-list", default: () => [] });
}

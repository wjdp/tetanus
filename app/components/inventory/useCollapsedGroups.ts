import type { GroupBy } from "./groupDisks";

export function useCollapsedGroups(groupBy: () => GroupBy | null) {
  const collapsed = ref(new Set<string>());

  watch(groupBy, () => {
    collapsed.value = new Set();
  });

  const isCollapsed = (key: string) => collapsed.value.has(key);

  const toggle = (key: string) => {
    const next = new Set(collapsed.value);
    if (!next.delete(key)) next.add(key);
    collapsed.value = next;
  };

  return { isCollapsed, toggle };
}

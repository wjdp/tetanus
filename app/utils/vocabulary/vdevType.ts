export interface VdevTypeVocabulary {
  icon: string;
  label: string;
}

export const VDEV_TYPE_VOCABULARY: Record<string, VdevTypeVocabulary> = {
  raidz1: { icon: "i-lucide-layers", label: "raidz1" },
  raidz2: { icon: "i-lucide-layers", label: "raidz2" },
  raidz3: { icon: "i-lucide-layers", label: "raidz3" },
  mirror: { icon: "i-lucide-copy", label: "mirror" },
  disk: { icon: "i-lucide-rows-2", label: "stripe" },
  file: { icon: "i-lucide-rows-2", label: "stripe" },
  special: { icon: "i-lucide-sparkles", label: "special" },
  log: { icon: "i-lucide-pen-line", label: "log" },
  cache: { icon: "i-lucide-zap", label: "cache" },
  spare: { icon: "i-lucide-life-buoy", label: "spares" },
  dedup: { icon: "i-lucide-git-merge", label: "dedup" },
  indirect: { icon: "i-lucide-corner-down-right", label: "indirect" },
};

export const vdevTypeVocabulary = (type: string): VdevTypeVocabulary | null =>
  Object.hasOwn(VDEV_TYPE_VOCABULARY, type) ? VDEV_TYPE_VOCABULARY[type] : null;

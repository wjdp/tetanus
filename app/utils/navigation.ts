export interface NavigationEntry {
  label: string;
  icon: string;
  to: string;
}

export const NAVIGATION: NavigationEntry[] = [
  { label: "Topology", icon: "i-lucide-network", to: "/" },
  { label: "Disks", icon: "i-lucide-hard-drive", to: "/disks" },
  { label: "ZFS", icon: "i-lucide-database", to: "/zfs" },
  { label: "Diary", icon: "i-lucide-notebook-pen", to: "/diary" },
  { label: "Settings", icon: "i-lucide-settings", to: "/settings" },
];

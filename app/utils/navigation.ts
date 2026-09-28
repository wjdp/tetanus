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

// Settings sub-pages: the settings layout's sub-nav and the command palette's
// "Settings" group both read from this rather than duplicating the list.
export const SETTINGS_NAVIGATION: NavigationEntry[] = [
  { label: "General", icon: "i-lucide-sliders-horizontal", to: "/settings" },
  { label: "Hosts", icon: "i-lucide-server", to: "/settings/hosts" },
  { label: "Import", icon: "i-lucide-import", to: "/settings/import" },
];

import type { NavigationCounts } from "#shared/navigation";

export type NavigationBadge = keyof NavigationCounts;

export interface NavigationEntry {
  label: string;
  icon: string;
  to: string;
  badge?: NavigationBadge;
}

export const NAVIGATION: NavigationEntry[] = [
  { label: "Topology", icon: "i-lucide-network", to: "/" },
  { label: "Faults", icon: "i-lucide-siren", to: "/faults", badge: "faults" },
  {
    label: "Disks",
    icon: "i-lucide-hard-drive",
    to: "/disks",
    badge: "disks",
  },
  { label: "ZFS", icon: "i-lucide-database", to: "/zfs", badge: "pools" },
  {
    label: "Replications",
    icon: "i-lucide-arrow-right-left",
    to: "/replications",
    badge: "replications",
  },
  { label: "Diary", icon: "i-lucide-notebook-pen", to: "/diary" },
  { label: "Settings", icon: "i-lucide-settings", to: "/settings" },
];

// Settings sub-pages: the settings layout's sub-nav and the command palette's
// "Settings" group both read from this rather than duplicating the list.
export const SETTINGS_NAVIGATION: NavigationEntry[] = [
  { label: "General", icon: "i-lucide-sliders-horizontal", to: "/settings" },
  { label: "Hosts", icon: "i-lucide-server", to: "/settings/hosts" },
  { label: "Alerts", icon: "i-lucide-bell", to: "/settings/alerts" },
  { label: "Import", icon: "i-lucide-import", to: "/settings/import" },
];

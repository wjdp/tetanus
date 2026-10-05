import type { NavigationCounts, StatusCounts } from "#shared/navigation";

export type NavigationBadge = keyof NavigationCounts;

export interface NavigationEntry {
  label: string;
  icon: string;
  to: string;
  badge?: NavigationBadge;
  bottomNav?: true;
  alsoActiveUnder?: string[];
}

export const NAVIGATION: NavigationEntry[] = [
  { label: "Topology", icon: "i-lucide-network", to: "/", bottomNav: true },
  {
    label: "Faults",
    icon: "i-lucide-siren",
    to: "/faults",
    badge: "faults",
    bottomNav: true,
  },
  { label: "Hosts", icon: "i-lucide-server", to: "/hosts", badge: "hosts" },
  {
    label: "Disks",
    icon: "i-lucide-hard-drive",
    to: "/disks",
    badge: "disks",
    bottomNav: true,
  },
  {
    label: "ZFS",
    icon: "i-lucide-database",
    to: "/zfs",
    badge: "pools",
    bottomNav: true,
    alsoActiveUnder: ["/datasets"],
  },
  {
    label: "Replications",
    icon: "i-lucide-arrow-right-left",
    to: "/replications",
    badge: "replications",
  },
  { label: "Diary", icon: "i-lucide-notebook-pen", to: "/diary" },
  { label: "Settings", icon: "i-lucide-settings", to: "/settings" },
];

const isAtOrUnder = (path: string, prefix: string) =>
  path === prefix || path.startsWith(`${prefix}/`);

export const isNavigationActive = (
  { to, alsoActiveUnder = [] }: NavigationEntry,
  path: string,
) =>
  to === "/"
    ? path === "/"
    : [to, ...alsoActiveUnder].some((prefix) => isAtOrUnder(path, prefix));

export const navigationChipColour = ({ error, warning }: StatusCounts) => {
  if (error > 0) return "error" as const;
  if (warning > 0) return "warning" as const;
  return undefined;
};

// Settings sub-pages: the settings layout's sub-nav and the command palette's
// "Settings" group both read from this rather than duplicating the list.
export const SETTINGS_NAVIGATION: NavigationEntry[] = [
  { label: "General", icon: "i-lucide-sliders-horizontal", to: "/settings" },
  { label: "Alerts", icon: "i-lucide-bell", to: "/settings/alerts" },
  { label: "Import", icon: "i-lucide-import", to: "/settings/import" },
];

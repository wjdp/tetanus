import {
  COLLECTOR_VERSION,
  type CollectorStatus,
  collectorStatus,
  MIN_COLLECTOR_VERSION,
} from "#shared/collector";

const SUMMARISED_TOOLS = ["zfs", "smartctl"];

export const shortToolVersion = (tool: string, version: string) =>
  version.replace(new RegExp(`^${tool}[- ]`), "").split(/\s+/)[0];

export const toolVersionLines = (toolVersions: Record<string, string>) =>
  SUMMARISED_TOOLS.filter((tool) => toolVersions[tool]).map(
    (tool) => `${tool} ${shortToolVersion(tool, toolVersions[tool])}`,
  );

const COLLECTOR_BADGES: Record<
  Exclude<CollectorStatus, "current">,
  { label: string; color: "warning" | "error" | "neutral" }
> = {
  outdated: { label: `${COLLECTOR_VERSION} available`, color: "warning" },
  incompatible: {
    label: `needs ${MIN_COLLECTOR_VERSION}+`,
    color: "error",
  },
  unknown: { label: "unknown", color: "neutral" },
};

export const collectorBadge = (version: string | null) => {
  const status = collectorStatus(version);
  return status === "current" ? null : COLLECTOR_BADGES[status];
};

export const needsUpgrade = (version: string | null) =>
  ["outdated", "incompatible"].includes(collectorStatus(version));

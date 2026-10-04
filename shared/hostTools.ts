import type { IngestSource } from "#shared/ingest";

export const HOST_TOOLS = ["openzfs", "smartmontools"] as const;
export type HostTool = (typeof HOST_TOOLS)[number];

interface HostToolRequirement {
  label: string;
  versionKey: string;
  pattern: RegExp;
  minVersion: string;
  sources: readonly IngestSource[];
  needs: string;
  missing: string;
}

export const HOST_TOOL_REQUIREMENTS: Record<HostTool, HostToolRequirement> = {
  openzfs: {
    label: "OpenZFS",
    versionKey: "zfs",
    pattern: /^zfs-(\d+)\.(\d+)(?:\.(\d+))?/,
    minVersion: "2.3",
    sources: ["zpool-status", "zpool-list", "zfs-list", "zfs-snapshots"],
    needs: "JSON output (-j)",
    missing: "no pool, dataset or snapshot data",
  },
  smartmontools: {
    label: "smartmontools",
    versionKey: "smartctl",
    pattern: /^smartctl (\d+)\.(\d+)(?:\.(\d+))?/,
    minVersion: "7.0",
    sources: ["smartctl-scan", "smartctl-xall"],
    needs: "JSON output (--json)",
    missing: "no SMART data",
  },
};

export interface UnsupportedTool {
  tool: HostTool;
  version: string;
  minVersion: string;
  sources: IngestSource[];
}

function versionParts(version: string) {
  return version.split(".").map(Number);
}

function isOlder(version: number[], than: string) {
  const minimum = versionParts(than);
  for (const [index, part] of minimum.entries()) {
    const actual = version[index] ?? 0;
    if (actual !== part) return actual < part;
  }
  return false;
}

export function toolVersion(tool: HostTool, raw: string | undefined) {
  const match = raw?.match(HOST_TOOL_REQUIREMENTS[tool].pattern);
  if (!match) return null;
  return match
    .slice(1)
    .filter((part) => part !== undefined)
    .join(".");
}

export function unsupportedTools(
  toolVersions: Record<string, string>,
): UnsupportedTool[] {
  return HOST_TOOLS.flatMap((tool) => {
    const requirement = HOST_TOOL_REQUIREMENTS[tool];
    const version = toolVersion(tool, toolVersions[requirement.versionKey]);
    if (
      version === null ||
      !isOlder(versionParts(version), requirement.minVersion)
    ) {
      return [];
    }
    return {
      tool,
      version,
      minVersion: requirement.minVersion,
      sources: [...requirement.sources],
    };
  });
}

export function hostToolMinimums() {
  return HOST_TOOLS.map((tool) => {
    const { label, minVersion } = HOST_TOOL_REQUIREMENTS[tool];
    return `${label} ${minVersion}+`;
  });
}

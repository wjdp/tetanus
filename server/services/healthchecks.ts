import { allGroupFreshness, formatDuration } from "#shared/hostFreshness";
import { listHosts } from "~~/server/services/hosts";

function staleGroupsBody(groups: ReturnType<typeof allGroupFreshness>) {
  return groups
    .filter((group) => group.status !== "ok")
    .map((group) => {
      const age = group.ageMs === null ? "never" : formatDuration(group.ageMs);
      return `${group.name}: ${group.status} (${age})`;
    })
    .join(", ");
}

export async function pingHealthchecks(
  now = new Date(),
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const hosts = listHosts().filter((host) => host.healthchecksUrl);
  for (const host of hosts) {
    const url = host.healthchecksUrl as string;
    const groups = allGroupFreshness(host.lastRuns, now.getTime());
    const allOk = groups.every((group) => group.status === "ok");
    try {
      if (allOk) {
        await fetchImpl(url, { signal: AbortSignal.timeout(10_000) });
      } else {
        await fetchImpl(`${url}/fail`, {
          method: "POST",
          body: staleGroupsBody(groups),
          signal: AbortSignal.timeout(10_000),
        });
      }
    } catch (error) {
      console.warn(`Healthchecks ping failed for ${host.name}`, error);
    }
  }
}

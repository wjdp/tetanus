import { createFleet, type Fleet } from "./fleet";
import { renderSmart } from "./smart";
import { createStories, type Stories } from "./stories";
import { createTimeline, DEMO_EPOCH, type Timeline } from "./timeline";
import type { HostPayloads } from "./types";
import { renderZfs } from "./zfs";

export interface DemoWorld {
  timeline: Timeline;
  fleet: Fleet;
  stories: Stories;
}

const worlds = new Map<number, DemoWorld>();

/** The fleet and its stories for one reset anchor (see `resetAnchor`); memoised per anchor. */
export function createWorld(anchor: Date = DEMO_EPOCH): DemoWorld {
  const cached = worlds.get(anchor.getTime());
  if (cached) return cached;
  const timeline = createTimeline(anchor);
  const fleet = createFleet(timeline);
  const world = { timeline, fleet, stories: createStories(timeline, fleet) };
  worlds.set(anchor.getTime(), world);
  return world;
}

/** Raw collector output for every host at `t`, exactly as `tetanus-collect` would POST it. */
export function worldAt(t: Date, anchor: Date = DEMO_EPOCH): HostPayloads[] {
  const world = createWorld(anchor);
  return world.fleet.hosts.map((host) => ({
    host: host.name,
    payloads: [...renderSmart(world, host, t), ...renderZfs(world, host, t)],
  }));
}

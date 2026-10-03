export interface ReceiveLine {
  at: Date;
  text: string;
}

export interface DerivedSync {
  target: string;
  at: Date;
  snapshotName: string | null;
  snapshots: number;
}

const FINISH_RE = /^finish receiving (\S+?)(?:\/%recv)? \(\d+\) snap=(\S+)/;
const COMMAND_RE = /^zfs (?:receive|recv)\b.* (\S+)$/;
const PARENT_FLAG_RE = /^-[A-Za-z]*[de][A-Za-z]*$/;

const MINUTE_MS = 60 * 1000;
export const CLUSTER_GAP_MS = 10 * MINUTE_MS;
export const CLUSTER_SETTLE_MS = 15 * MINUTE_MS;

/** History rows worth reading: a prefilter for `isReceiveLine`. */
export const RECEIVE_LINE_PATTERNS = [
  "finish receiving %",
  "zfs receive %",
  "zfs recv %",
];

interface Finish {
  kind: "finish";
  at: Date;
  target: string;
  snapshotName: string;
}

interface Command {
  kind: "command";
  at: Date;
  target: string;
  namesParent: boolean;
}

type ReceiveEvent = Finish | Command;

function parseLine({ at, text }: ReceiveLine): ReceiveEvent | null {
  const finish = text.match(FINISH_RE);
  if (finish?.[1] && finish[2]) {
    return { kind: "finish", at, target: finish[1], snapshotName: finish[2] };
  }
  const command = text.match(COMMAND_RE);
  if (command?.[1]) {
    const flags = text.split(/\s+/).slice(2, -1);
    return {
      kind: "command",
      at,
      target: command[1],
      namesParent: flags.some((flag) => PARENT_FLAG_RE.test(flag)),
    };
  }
  return null;
}

export function isReceiveLine(text: string) {
  return FINISH_RE.test(text) || COMMAND_RE.test(text);
}

// At one second a run's last finish line and its command line are logged
// together, in either id order: the finish always goes first.
function byTimeFinishFirst(a: ReceiveEvent, b: ReceiveEvent) {
  return (
    a.at.getTime() - b.at.getTime() ||
    (a.kind === b.kind ? 0 : a.kind === "finish" ? -1 : 1)
  );
}

const isUnder = (target: string, parent: string) =>
  target.startsWith(`${parent}/`);

/**
 * Receive history lines of one host into syncs, one per run. A command line
 * closes its target's pending finish lines; a run with no command line is a
 * cluster of finish lines, cut by a gap, that becomes a sync once settled.
 */
export function deriveSyncs(
  lines: readonly ReceiveLine[],
  receivedAt: Date,
): DerivedSync[] {
  const events = lines
    .map(parseLine)
    .filter((event): event is ReceiveEvent => event !== null)
    .sort(byTimeFinishFirst);
  const pending = new Map<string, Finish[]>();
  const syncs: DerivedSync[] = [];

  const close = (target: string, at?: Date) => {
    const finishes = pending.get(target);
    pending.delete(target);
    const last = finishes?.at(-1);
    if (!finishes || !last) return;
    syncs.push({
      target,
      at: at ?? last.at,
      snapshotName: last.snapshotName,
      snapshots: finishes.length,
    });
  };

  for (const event of events) {
    if (event.kind === "finish") {
      const last = pending.get(event.target)?.at(-1);
      if (last && event.at.getTime() - last.at.getTime() > CLUSTER_GAP_MS) {
        close(event.target);
      }
      const finishes = pending.get(event.target) ?? [];
      finishes.push(event);
      pending.set(event.target, finishes);
      continue;
    }
    const own = pending.has(event.target);
    close(event.target, event.at);
    if (own && !event.namesParent) continue;
    for (const target of [...pending.keys()]) {
      if (isUnder(target, event.target)) close(target, event.at);
    }
  }

  const settledBefore = receivedAt.getTime() - CLUSTER_SETTLE_MS;
  for (const [target, finishes] of pending) {
    const last = finishes.at(-1);
    if (last && last.at.getTime() <= settledBefore) close(target);
  }
  return syncs.sort(
    (a, b) =>
      a.at.getTime() - b.at.getTime() || a.target.localeCompare(b.target),
  );
}

import { describe, expect, it } from "vitest";
import { isRoutineHistory, retainedHistoryEntries } from "./history";

const command = (text: string) => ({ internal: false, text });
const internal = (text: string) => ({ internal: true, text });

describe("isRoutineHistory", () => {
  it.each([
    command("zfs snapshot tank/home@autosnap_2026-10-03_21:00:07_hourly"),
    command("zfs destroy tank/git@syncoid_host_2026-10-03:21:00:08-GMT01:00"),
    command("zfs destroy -r tank/media@autosnap_2026-10-03_21:00:07_hourly"),
    command("zfs receive -s -F tank/replicas/zeta/var"),
    command("zfs send -w tank/home@autosnap_2026-10-03_21:00:07_hourly"),
    command(
      "(59ms) ioctl destroy_snaps\n    input:\n        snaps:\n            tank/config@autosnap_2026-10-05_16:45:05_frequently",
    ),
    command(
      "(56ms) ioctl snapshot\n    input:\n        snaps:\n            tank/photos@autosnap",
    ),
    command("(12ms) ioctl hold\n    input:"),
    internal("snapshot tank/home@autosnap_2026-10-03_21:00:07_hourly (159266)"),
    internal("destroy tank/home@autosnap_2026-10-02_21:00:04_hourly (135393)"),
    internal("destroy tank/zeta/var/%recv (31274)"),
    internal("destroy tank/zeta/var/%rollback (31275)"),
    internal("receive tank/replicas/zeta/var/%recv (57150)"),
    internal(
      "finish receiving tank/replicas/zeta/var/%recv (57150) snap=autosnap_2026-09-12_20:00:04_hourly",
    ),
    internal("clone swap tank/replicas/zeta/var/%recv (57150) parent=var"),
    internal("hold zeta/var@syncoid_host_2026-10-04:06:00:26-GMT01:00 (97647)"),
    internal(
      "release zeta/var@syncoid_host_2026-10-03:06:00:24-GMT01:00 (97647) tag=.send-1",
    ),
  ])("treats %o as routine", (entry) => {
    expect(isRoutineHistory(entry)).toBe(true);
  });

  it.each([
    command("zpool create tank raidz2 sda sdb sdc sdd"),
    command("zpool import -N tank"),
    command("zpool scrub tank"),
    command("zfs create tank/media"),
    command("zfs destroy -r tank/old"),
    command("zfs rename tank/a tank/b"),
    command("zfs set compression=lz4 tank"),
    command("zfs rollback -R tank/home@autosnap"),
    command("(3ms) ioctl reopen\n    input:"),
    internal("create tank/media (1234)"),
    internal("destroy tank/old (1235)"),
    internal("set tank (54) compression=4"),
    internal("scan setup func=1 mintxg=0 maxtxg=13315345"),
  ])("keeps %o", (entry) => {
    expect(isRoutineHistory(entry)).toBe(false);
  });
});

describe("retainedHistoryEntries", () => {
  const receivedAt = new Date("2026-10-05T12:00:00Z");
  const daysAgo = (days: number) =>
    new Date(receivedAt.getTime() - days * 24 * 60 * 60 * 1000).toISOString();

  it("drops routine lines older than the cutoff less the receive window", () => {
    const entries = [
      { at: daysAgo(13), ...internal("receive tank/r/%recv (1)") },
      { at: daysAgo(11), ...internal("receive tank/r/%recv (2)") },
      { at: daysAgo(100), ...command("zfs create tank/media") },
    ];
    expect(retainedHistoryEntries(entries, receivedAt)).toEqual(
      entries.slice(1),
    );
  });
});

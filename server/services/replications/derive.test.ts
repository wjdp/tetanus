import { describe, expect, it } from "vitest";
import { deriveSyncs, isReceiveLine, type ReceiveLine } from "./derive";

const MINUTE_MS = 60 * 1000;
const t0 = Date.parse("2026-10-02T05:00:00Z");
const at = (seconds: number) => new Date(t0 + seconds * 1000);
const line = (seconds: number, text: string): ReceiveLine => ({
  at: at(seconds),
  text,
});
const finish = (seconds: number, target: string, snap: string, txg = 100) =>
  line(seconds, `finish receiving ${target}/%recv (${txg}) snap=${snap}`);
const command = (seconds: number, target: string) =>
  line(seconds, `zfs receive -s -F ${target}`);
const later = at(24 * 60 * 60);

describe("isReceiveLine", () => {
  it("knows finish and command lines, old and new", () => {
    expect(isReceiveLine("finish receiving tank/a/%recv (1) snap=s")).toBe(
      true,
    );
    expect(isReceiveLine("finish receiving zeta/p.clone (1949) snap=s")).toBe(
      true,
    );
    expect(isReceiveLine("zfs recv -F vpool/tank/a")).toBe(true);
    expect(isReceiveLine("zfs destroy tank/a@s")).toBe(false);
  });
});

describe("deriveSyncs", () => {
  it("makes one sync of a daily run of many snapshots", () => {
    const target = "tank/copies/zeta/q";
    const lines = [
      ...Array.from({ length: 30 }, (_, index) =>
        finish(60 + index, target, `autosnap_2026-10-02_${index}_hourly`),
      ),
      finish(90, target, "syncoid_vault_2026-10-02:06:00:20-GMT01:00"),
      command(90, target),
      ...Array.from({ length: 5 }, (_, index) =>
        finish(86_460 + index, target, `autosnap_2026-10-03_${index}_hourly`),
      ),
      command(86_466, target),
    ];
    expect(deriveSyncs(lines, later)).toEqual([
      {
        target,
        at: at(90),
        snapshotName: "syncoid_vault_2026-10-02:06:00:20-GMT01:00",
        snapshots: 31,
      },
      {
        target,
        at: at(86_466),
        snapshotName: "autosnap_2026-10-03_4_hourly",
        snapshots: 5,
      },
    ]);
  });

  it("makes one sync per hour of an hourly pull", () => {
    const lines = [0, 1, 2].flatMap((hour) => [
      finish(hour * 3600 + 20, "vpool/tank/a", `syncoid_vault_${hour}`),
      command(hour * 3600 + 21, "vpool/tank/a"),
    ]);
    expect(
      deriveSyncs(lines, later).map((sync) => [sync.at, sync.snapshots]),
    ).toEqual([
      [at(21), 1],
      [at(3621), 1],
      [at(7221), 1],
    ]);
  });

  it("puts a finish line before the command logged in the same second", () => {
    const lines = [
      command(30, "vpool/zeta/q"),
      finish(30, "vpool/zeta/q", "syncoid_vault_1"),
    ];
    expect(deriveSyncs(lines, later)).toEqual([
      {
        target: "vpool/zeta/q",
        at: at(30),
        snapshotName: "syncoid_vault_1",
        snapshots: 1,
      },
    ]);
  });

  it("reads the old finish format without %recv", () => {
    const lines = [
      line(10, "finish receiving zeta/p.clone (1949) snap=autosnap_old"),
      line(11, "zfs receive -s -F zeta/p.clone"),
    ];
    expect(deriveSyncs(lines, later)).toEqual([
      {
        target: "zeta/p.clone",
        at: at(11),
        snapshotName: "autosnap_old",
        snapshots: 1,
      },
    ]);
  });

  it("lets a -d receive close the datasets under the parent it names", () => {
    const lines = [
      finish(10, "vpool/tank/a", "s1"),
      finish(11, "vpool/tank/b", "s1"),
      finish(12, "vpoolx/c", "s1"),
      line(13, "zfs receive -d -F vpool"),
    ];
    expect(
      deriveSyncs(lines, at(13)).map((sync) => [sync.target, sync.at]),
    ).toEqual([
      ["vpool/tank/a", at(13)],
      ["vpool/tank/b", at(13)],
    ]);
  });

  it("keeps a child's run out of its parent's command", () => {
    const lines = [
      finish(30, "vpool/zeta/q", "s1"),
      finish(31, "vpool/zeta/q/r", "s1"),
      command(31, "vpool/zeta/q"),
      command(33, "vpool/zeta/q/r"),
    ];
    expect(
      deriveSyncs(lines, later).map((sync) => [sync.target, sync.at]),
    ).toEqual([
      ["vpool/zeta/q", at(31)],
      ["vpool/zeta/q/r", at(33)],
    ]);
  });

  it("does not count a command with nothing pending", () => {
    expect(deriveSyncs([command(10, "vpool/tank/a")], later)).toEqual([]);
  });

  it("clusters finish lines with no command, cut by a gap and settled", () => {
    const gap = (11 * MINUTE_MS) / 1000;
    const lines = [
      finish(0, "tank/a", "s1"),
      finish(1, "tank/a", "s2"),
      finish(gap, "tank/a", "s3"),
    ];
    expect(deriveSyncs(lines, at(gap + 14 * 60))).toEqual([
      { target: "tank/a", at: at(1), snapshotName: "s2", snapshots: 2 },
    ]);
    expect(deriveSyncs(lines, at(gap + 15 * 60))).toEqual([
      { target: "tank/a", at: at(1), snapshotName: "s2", snapshots: 2 },
      { target: "tank/a", at: at(gap), snapshotName: "s3", snapshots: 1 },
    ]);
  });
});

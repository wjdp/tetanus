import { describe, expect, it } from "vitest";
import { parse } from "./zfs-receives";

describe("zfs-receives parser", () => {
  it("reads receive lines under each pool's header", () => {
    const body = [
      "History for 'vpool':",
      "2026-10-02.22:00:19 zfs receive -s -F vpool/zeta/q [user 0 (root) on vault:linux]",
      "2026-10-02.22:00:19 [txg:85264673] finish receiving vpool/zeta/q/%recv (52213) snap=syncoid_vault_2026-10-02:23:00:19-GMT01:00   [on vault]",
      "History for 'empty':",
      "",
    ].join("\n");
    const { data, summary } = parse(body, {});
    expect(summary).toEqual({ entries: 2, pools: 1 });
    expect(
      data.entries.map(({ pool, at, internal, text }) => ({
        pool,
        at,
        internal,
        text,
      })),
    ).toEqual([
      {
        pool: "vpool",
        at: "2026-10-02T22:00:19.000Z",
        internal: false,
        text: "zfs receive -s -F vpool/zeta/q",
      },
      {
        pool: "vpool",
        at: "2026-10-02T22:00:19.000Z",
        internal: true,
        text: "finish receiving vpool/zeta/q/%recv (52213) snap=syncoid_vault_2026-10-02:23:00:19-GMT01:00",
      },
    ]);
  });

  it("accepts pools with no receives", () => {
    expect(
      parse("History for 'tank':\nHistory for 'zeta':\n", {}).data.entries,
    ).toEqual([]);
  });
});

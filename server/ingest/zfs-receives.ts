import type { Parser } from "#shared/ingest";
import { parseHistory, type ZpoolHistoryResult } from "./zpool-history";

/** `zpool history -il` per pool, filtered to receive lines; a pool may have none. */
export const parse: Parser<ZpoolHistoryResult> = (body) =>
  parseHistory(body, { source: "zfs-receives", allowEmpty: true });

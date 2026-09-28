import type { Parser } from "#shared/ingest";

export const parse: Parser<unknown> = () => {
  throw new Error("zfs-snapshots parser not implemented");
};

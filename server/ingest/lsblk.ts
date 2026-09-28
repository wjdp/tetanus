import type { Parser } from "#shared/ingest";

export const parse: Parser<unknown> = () => {
  throw new Error("lsblk parser not implemented");
};

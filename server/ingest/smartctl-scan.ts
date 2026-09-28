import type { Parser } from "#shared/ingest";

export const parse: Parser<unknown> = () => {
  throw new Error("smartctl-scan parser not implemented");
};

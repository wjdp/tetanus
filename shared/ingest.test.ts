import { describe, expect, it } from "vitest";
import {
  HOST_HEADER,
  hostNameSchema,
  INGEST_SOURCES,
  ingestMetaSchema,
  isIngestSource,
} from "./ingest";

describe("HOST_HEADER", () => {
  it("is the title-cased app name with a Host suffix", () => {
    expect(HOST_HEADER).toBe("Tetanus-Host");
  });
});

describe("INGEST_SOURCES", () => {
  it("lists every v1 source once", () => {
    expect(INGEST_SOURCES).toHaveLength(13);
    expect(new Set(INGEST_SOURCES).size).toBe(INGEST_SOURCES.length);
  });

  it("recognises known sources only", () => {
    expect(isIngestSource("zpool-status")).toBe(true);
    expect(isIngestSource("zpool-statuses")).toBe(false);
  });
});

describe("hostNameSchema", () => {
  it("normalises case and whitespace", () => {
    expect(hostNameSchema.parse("  Mars.Local \n")).toBe("mars.local");
  });

  it.each(["", "-mars", "mars_2", "mars host", "a".repeat(64)])(
    "rejects %j",
    (name) => {
      expect(hostNameSchema.safeParse(name).success).toBe(false);
    },
  );

  it("accepts a 63-character name", () => {
    expect(hostNameSchema.parse("a".repeat(63))).toBe("a".repeat(63));
  });
});

describe("ingestMetaSchema", () => {
  it("accepts an empty query", () => {
    expect(ingestMetaSchema.parse({})).toEqual({});
  });

  it("parses smartctl query parameters", () => {
    expect(
      ingestMetaSchema.parse({
        device: "/dev/sdc",
        type: "sat",
        exitStatus: "64",
      }),
    ).toEqual({ device: "/dev/sdc", type: "sat", exitStatus: 64 });
  });

  it.each(["", "-1", "256", "1.5", "abc"])(
    "rejects exitStatus %j",
    (exitStatus) => {
      expect(ingestMetaSchema.safeParse({ exitStatus }).success).toBe(false);
    },
  );
});

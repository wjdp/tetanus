import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "~~/server/database/client";
import { collectorRun, host, payload } from "~~/server/database/schema";
import { HANDLERS, type IngestHandler } from "~~/server/ingest/handlers";
import { recordIngest } from "~~/server/services/ingest";
import { flushDb } from "~~/test/db";

const receivedAt = new Date("2026-09-01T10:00:00Z");

describe("recordIngest", () => {
  beforeEach(() => {
    flushDb();
  });

  it.each([
    ["tetanus-collect/0.7.0", "0.7.0", "current"],
    ["tetanus-zed/0.3.1", null, "unknown"],
    [null, null, "unknown"],
  ])("takes the collector version from %s", (producer, version, status) => {
    recordIngest({
      hostName: "mars",
      source: "versions",
      meta: {},
      body: "zfs=2.4.1\n",
      producer,
      receivedAt,
    });
    expect(db.select().from(host).get()).toMatchObject({
      collectorVersion: version,
      collectorStatus: status,
    });
  });

  it("records a parsed payload, a run and the host's tool versions", () => {
    const outcome = recordIngest({
      hostName: "mars",
      source: "versions",
      meta: {},
      body: "zfs=2.4.1\nkernel=6.8\n",
      producer: "tetanus-collect/1",
      receivedAt,
    });

    expect(outcome).toEqual({
      ok: true,
      source: "versions",
      host: "mars",
      summary: { keys: 2 },
    });
    const [mars] = db.select().from(host).all();
    expect(mars.toolVersions).toEqual({ zfs: "2.4.1", kernel: "6.8" });
    expect(db.select().from(collectorRun).all()).toEqual([
      expect.objectContaining({
        hostId: mars.id,
        source: "versions",
        ok: true,
        error: null,
        bytes: 21,
        producer: "tetanus-collect/1",
        receivedAt,
      }),
    ]);
    expect(db.select().from(payload).all()).toEqual([
      expect.objectContaining({
        hostId: mars.id,
        source: "versions",
        device: "",
        body: "zfs=2.4.1\nkernel=6.8\n",
      }),
    ]);
  });

  it("keeps one payload per host, source and device", () => {
    const later = new Date("2026-09-01T11:00:00Z");
    recordIngest({
      hostName: "mars",
      source: "versions",
      meta: {},
      body: "zfs=1",
      receivedAt,
    });
    recordIngest({
      hostName: "mars",
      source: "versions",
      meta: {},
      body: "zfs=2",
      receivedAt: later,
    });

    expect(db.select().from(payload).all()).toEqual([
      expect.objectContaining({ body: "zfs=2", receivedAt: later }),
    ]);
    expect(db.select().from(collectorRun).all()).toHaveLength(2);
  });

  it("keeps separate payloads per device", () => {
    for (const device of ["/dev/sda", "/dev/sdb", "/dev/sda"]) {
      recordIngest({
        hostName: "mars",
        source: "versions",
        meta: { device },
        body: "zfs=1",
      });
    }
    expect(
      db
        .select({ device: payload.device })
        .from(payload)
        .all()
        .map((row) => row.device)
        .sort(),
    ).toEqual(["/dev/sda", "/dev/sdb"]);
  });

  it("stores smartctl meta on the run", () => {
    recordIngest({
      hostName: "mars",
      source: "versions",
      meta: { device: "/dev/sdc", type: "sat", exitStatus: 64 },
      body: "zfs=1",
    });
    expect(db.select().from(collectorRun).get()).toMatchObject({
      device: "/dev/sdc",
      deviceType: "sat",
      exitStatus: 64,
    });
  });

  it("records a failed run without a payload when parsing throws", () => {
    const outcome = recordIngest({
      hostName: "mars",
      source: "versions",
      meta: {},
      body: "not a key value line",
    });

    expect(outcome).toEqual({
      ok: false,
      error: expect.stringContaining("not KEY=value"),
    });
    expect(db.select().from(collectorRun).get()).toMatchObject({
      ok: false,
      error: expect.stringContaining("not KEY=value"),
    });
    expect(db.select().from(payload).all()).toEqual([]);
  });

  it("records a reported command failure with its stderr, without parsing", () => {
    const outcome = recordIngest({
      hostName: "mars",
      source: "zpool-status",
      meta: { failed: 2 },
      body: "invalid option 'j'\nusage:\n\tstatus [-c script] [pool]\n\tthird\n",
    });

    expect(outcome).toEqual({
      ok: false,
      reported: true,
      error:
        "Command exited 2: invalid option 'j' / usage: / status [-c script] [pool]",
    });
    expect(db.select().from(collectorRun).get()).toMatchObject({
      source: "zpool-status",
      ok: false,
      exitStatus: 2,
      error: outcome.ok ? null : outcome.error,
    });
    expect(db.select().from(payload).all()).toEqual([]);
  });

  it("rejects an unknown source after upserting the host", () => {
    expect(() =>
      recordIngest({ hostName: "mars", source: "nope", meta: {}, body: "" }),
    ).toThrow(expect.objectContaining({ statusCode: 400 }));
    expect(db.select().from(host).all()).toHaveLength(1);
    expect(db.select().from(collectorRun).all()).toEqual([]);
  });

  describe("with a handler", () => {
    function withHandler(handler: IngestHandler, test: () => void) {
      const original = HANDLERS.versions;
      HANDLERS.versions = handler;
      try {
        test();
      } finally {
        HANDLERS.versions = original;
      }
    }

    it("passes the parsed data and context to the source's handler", () => {
      const handler = vi.fn();
      withHandler(handler, () => {
        recordIngest({
          hostName: "mars",
          source: "versions",
          meta: { device: "/dev/sda" },
          body: "zfs=1",
          receivedAt,
        });
      });

      const [mars] = db.select().from(host).all();
      expect(handler).toHaveBeenCalledWith({
        hostId: mars.id,
        hostName: "mars",
        receivedAt,
        meta: { device: "/dev/sda" },
        data: { zfs: "1" },
        body: "zfs=1",
      });
    });

    it("keeps the payload and an ok run when the handler throws, rolling back its writes", () => {
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      withHandler(
        ({ hostId }) => {
          db.update(host)
            .set({ notes: "half-written" })
            .where(eq(host.id, hostId))
            .run();
          throw new Error("disk vanished mid-write");
        },
        () => {
          const outcome = recordIngest({
            hostName: "mars",
            source: "versions",
            meta: {},
            body: "zfs=1",
            receivedAt,
          });
          expect(outcome).toEqual({
            ok: true,
            source: "versions",
            host: "mars",
            summary: { keys: 1 },
          });
        },
      );

      expect(consoleError).toHaveBeenCalled();
      consoleError.mockRestore();
      expect(db.select().from(collectorRun).get()).toMatchObject({
        ok: true,
        error: "disk vanished mid-write",
      });
      expect(db.select().from(payload).get()).toMatchObject({ body: "zfs=1" });
      expect(db.select().from(host).get()).toMatchObject({ notes: "" });
    });
  });
});

describe("alerts tick after ingest", () => {
  const items = new Map<string, unknown>();
  const storage = {
    get: async (key: string) => items.get(key) ?? null,
    set: async (key: string, value: unknown) => {
      items.set(key, value);
    },
    remove: async (key: string) => {
      items.delete(key);
    },
    getKeys: async (base: string) =>
      [...items.keys()].filter((key) => key.startsWith(base)),
    getItems: async (keys: string[]) =>
      keys.map((key) => ({ key, value: items.get(key) })),
  };

  async function queuedTasks() {
    await vi.waitFor(async () => {
      expect((await storage.getKeys("task:")).length).toBeGreaterThan(0);
    });
    return (await storage.getItems(await storage.getKeys("task:"))).map(
      ({ value }) => value,
    );
  }

  beforeEach(() => {
    flushDb();
    items.clear();
    vi.stubGlobal("useStorage", () => storage);
    vi.stubGlobal("runTask", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const ingest = () =>
    recordIngest({
      hostName: "mars",
      source: "versions",
      meta: {},
      body: "zfs=2.4.1\n",
      receivedAt,
    });

  it("queues an alerts tick after a successful ingest", async () => {
    ingest();
    expect(await queuedTasks()).toEqual([
      expect.objectContaining({ name: "alerts:tick", state: "pending" }),
    ]);
  });

  it("does not queue a second tick while one is pending", async () => {
    ingest();
    await queuedTasks();
    ingest();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await queuedTasks()).toHaveLength(1);
  });

  it("does not queue a tick when parsing fails", async () => {
    recordIngest({
      hostName: "mars",
      source: "versions",
      meta: {},
      body: "not a key value line",
      receivedAt,
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await storage.getKeys("task:")).toEqual([]);
  });

  it("stays quiet when task storage is not initialised", async () => {
    vi.unstubAllGlobals();
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    ingest();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("logs other queue failures", async () => {
    vi.stubGlobal("useStorage", () => {
      throw new Error("storage offline");
    });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    ingest();
    await vi.waitFor(() =>
      expect(consoleError).toHaveBeenCalledWith(
        "Could not queue alerts:tick",
        expect.objectContaining({ message: "storage offline" }),
      ),
    );
    consoleError.mockRestore();
  });
});

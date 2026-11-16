// @vitest-environment nuxt
import { mountSuspended, registerEndpoint } from "@nuxt/test-utils/runtime";
import { getQuery } from "h3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Events from "./Events.vue";

const event = (id: number, eventClass: string) => ({
  id,
  hostId: 1,
  eid: id,
  at: new Date(Date.UTC(2026, 8, 28, 9, id)).toISOString(),
  class: eventClass,
  poolGuid: "1",
  vdevGuid: null,
  payload: {},
});

const requests: Record<string, unknown>[] = [];

registerEndpoint("/api/pools/7/events", (event_) => {
  const query = getQuery(event_);
  requests.push(query);
  const items =
    query.all === "true"
      ? [
          event(2, "sysevent.fs.zfs.history_event"),
          event(1, "sysevent.fs.zfs.scrub_start"),
        ]
      : [event(1, "sysevent.fs.zfs.scrub_start")];
  return { items, hasMore: false, total: items.length };
});

registerEndpoint("/api/pools/8/events", () => ({
  items: [],
  hasMore: false,
  total: 0,
}));

const mount = (poolId: number, route = "/zfs/nas1/tank?tab=events") =>
  mountSuspended(Events, { props: { poolId, root: null }, route });

const classes = (page: Awaited<ReturnType<typeof mount>>) =>
  page.findAll('[data-testid="pool-event"]').map((row) => row.text());

beforeEach(() => {
  requests.length = 0;
});

describe("pool events", () => {
  it("leaves out history events by default", async () => {
    const page = await mount(7);
    await vi.waitFor(() => expect(classes(page)).toHaveLength(1));
    expect(classes(page)[0]).toContain("sysevent.fs.zfs.scrub_start");
    expect(requests[0]).not.toHaveProperty("all");
  });

  it("asks for history events when the toggle is in the query", async () => {
    const page = await mount(7, "/zfs/nas1/tank?tab=events&events=all");
    await vi.waitFor(() => expect(classes(page)).toHaveLength(2));
    expect(classes(page)[0]).toContain("sysevent.fs.zfs.history_event");
    expect(requests[0]).toMatchObject({ all: "true" });
  });

  it("says history events are hidden when nothing else is left", async () => {
    const page = await mount(8);
    await vi.waitFor(() =>
      expect(page.text()).toContain(
        "No events beyond history events, which repeat pool history.",
      ),
    );
  });
});

// @vitest-environment nuxt
import { mountSuspended, registerEndpoint } from "@nuxt/test-utils/runtime";
import { flushPromises } from "@vue/test-utils";
import { getQuery } from "h3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import HistoryList from "./HistoryList.vue";

const line = (id: number, text: string, routine = false) => ({
  id,
  hostId: 1,
  poolId: 7,
  at: new Date(Date.UTC(2026, 8, 20, 0, id)).toISOString(),
  internal: false,
  text,
  routine,
});

const requests: Record<string, unknown>[] = [];

type ObserverCallback = (entries: Partial<IntersectionObserverEntry>[]) => void;
const observed = new Map<Element, ObserverCallback>();

class FakeIntersectionObserver {
  constructor(private readonly callback: ObserverCallback) {}
  observe(target: Element) {
    observed.set(target, this.callback);
  }
  unobserve(target: Element) {
    observed.delete(target);
  }
  disconnect() {
    observed.clear();
  }
}

function scrollIntoView(target: Element | undefined) {
  if (!target) throw new Error("nothing to scroll to");
  observed.get(target)?.([{ isIntersecting: true, time: Date.now(), target }]);
}

registerEndpoint("/api/pools/7/history", (event) => {
  const query = getQuery(event);
  requests.push(query);
  if (query.beforeId === "2")
    return {
      lines: [line(1, "zfs create tank/a")],
      scope: "pool",
      hasMore: false,
    };
  if (query.all === "true")
    return {
      lines: [line(3, "zfs snapshot tank/a@autosnap", true)],
      scope: "pool",
      hasMore: false,
    };
  return { lines: [line(2, "zpool scrub tank")], scope: "pool", hasMore: true };
});

const mount = (route = "/zfs/nas1/tank?tab=history") =>
  mountSuspended(HistoryList, {
    props: { poolId: 7, hostName: "nas1" },
    route,
  });

const texts = (page: Awaited<ReturnType<typeof mount>>) =>
  page.findAll('[data-testid="history-lines"] li').map((item) => item.text());

beforeEach(() => {
  requests.length = 0;
  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("pool history list", () => {
  it("shows the pool's record and loads older lines when scrolled to the end", async () => {
    const page = await mount();
    await vi.waitFor(() => expect(texts(page)).toHaveLength(1));
    expect(texts(page)[0]).toContain("zpool scrub tank");
    expect(requests).toHaveLength(1);

    scrollIntoView(page.find('[data-testid="history-end"]').element);

    await vi.waitFor(() => expect(texts(page)).toHaveLength(2));
    expect(texts(page)[1]).toContain("zfs create tank/a");
    expect(requests.at(-1)).toMatchObject({
      beforeId: "2",
      beforeAt: String(Date.UTC(2026, 8, 20, 0, 2)),
    });
    expect(page.find('[data-testid="history-load-older"]').exists()).toBe(
      false,
    );
  });

  it("asks for every line when the toggle is in the query", async () => {
    const page = await mount("/zfs/nas1/tank?tab=history&history=all");
    await vi.waitFor(() => expect(texts(page)).toHaveLength(1));
    expect(texts(page)[0]).toContain("zfs snapshot tank/a@autosnap");
    expect(requests[0]).toMatchObject({ all: "true" });
  });

  it("says when the host's history has no pool headers", async () => {
    registerEndpoint("/api/pools/8/history", () => ({
      lines: [],
      scope: "host",
      hasMore: false,
    }));
    const page = await mountSuspended(HistoryList, {
      props: { poolId: 8, hostName: "nas1" },
    });
    await flushPromises();
    await vi.waitFor(() =>
      expect(page.text()).toContain("Showing every pool on nas1"),
    );
    expect(page.text()).toContain(
      "No history beyond snapshot and replication lines.",
    );
  });
});

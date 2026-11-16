// @vitest-environment nuxt
import { describe, expect, it } from "vitest";
import { useInfiniteList } from "./useInfiniteList";

const item = (id: number) => ({
  id,
  at: new Date(Date.UTC(2026, 8, 1, 0, id)).toISOString(),
});

function fakeServer(count: number) {
  const requests: Record<string, number | undefined>[] = [];
  const fetchPage = async (query: {
    limit: number;
    beforeAt?: number;
    beforeId?: number;
  }) => {
    requests.push(query);
    const newestFirst = Array.from({ length: count }, (_, index) =>
      item(count - index),
    );
    const older = newestFirst.filter(
      (row) => query.beforeId === undefined || row.id < query.beforeId,
    );
    return {
      items: older.slice(0, query.limit),
      hasMore: older.length > query.limit,
      total: count,
    };
  };
  return { requests, fetchPage };
}

describe("useInfiniteList", () => {
  it("loads pages after the last item until none remain", async () => {
    const { requests, fetchPage } = fakeServer(70);
    const list = useInfiniteList(fetchPage);

    await list.reload();
    expect(list.items.value).toHaveLength(50);
    expect(list.hasMore.value).toBe(true);
    expect(list.total.value).toBe(70);

    await list.loadMore();
    expect(list.items.value).toHaveLength(70);
    expect(list.hasMore.value).toBe(false);
    expect(requests.at(-1)).toEqual({
      limit: 50,
      beforeAt: Date.parse(item(21).at),
      beforeId: 21,
    });
  });

  it("refreshes as many items as are shown, keeping the reader's place", async () => {
    const { requests, fetchPage } = fakeServer(120);
    const list = useInfiniteList(fetchPage);
    await list.reload();
    await list.loadMore();

    await list.refresh();

    expect(requests.at(-1)).toEqual({ limit: 100 });
    expect(list.items.value).toHaveLength(100);
    expect(list.status.value).toBe("success");
  });

  it("ignores a page that a newer request has overtaken", async () => {
    let call = 0;
    const list = useInfiniteList(async () => {
      call += 1;
      const mine = call;
      await new Promise((resolve) => setTimeout(resolve, mine === 1 ? 20 : 0));
      return { items: [item(mine)], hasMore: false };
    });

    await Promise.all([list.reload(), list.reload()]);

    expect(list.items.value).toEqual([item(2)]);
  });

  it("reports a failed page and retries it", async () => {
    let fail = true;
    const list = useInfiniteList(async () => {
      if (fail) throw new Error("offline");
      return { items: [item(1)], hasMore: false };
    });

    await list.reload();
    expect(list.status.value).toBe("error");

    fail = false;
    await list.retry();
    expect(list.status.value).toBe("success");
    expect(list.items.value).toEqual([item(1)]);
  });
});

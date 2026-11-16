import {
  MAX_PAGE_SIZE,
  PAGE_SIZE,
  type PageCursor,
} from "#shared/schemas/page";

export interface PagedItem {
  id: number;
  at: string;
}

export interface FetchedPage<T> {
  items: T[];
  hasMore: boolean;
  total?: number;
}

export type InfiniteListStatus = "pending" | "success" | "error";

/**
 * A newest-first list fetched a page at a time. `fetchPage` gets the page size and,
 * for older pages, the cursor of the last item shown. Pair with `InfiniteListEnd`.
 */
export function useInfiniteList<T extends PagedItem>(
  fetchPage: (query: { limit: number } & PageCursor) => Promise<FetchedPage<T>>,
) {
  const items = ref<T[]>([]) as Ref<T[]>;
  const hasMore = ref(false);
  const total = ref<number | null>(null);
  const status = ref<InfiniteListStatus>("pending");
  let latestRequest = 0;

  async function fetchInto(
    query: { limit: number } & PageCursor,
    apply: (page: FetchedPage<T>) => void,
    { quiet = false } = {},
  ) {
    const request = ++latestRequest;
    if (!quiet) status.value = "pending";
    try {
      const page = await fetchPage(query);
      if (request !== latestRequest) return;
      apply(page);
      hasMore.value = page.hasMore;
      total.value = page.total ?? null;
      status.value = "success";
    } catch {
      if (request === latestRequest && !quiet) status.value = "error";
    }
  }

  /** Starts again from the newest page, e.g. after a filter changes. */
  const reload = () =>
    fetchInto({ limit: PAGE_SIZE }, (page) => {
      items.value = page.items;
    });

  const loadMore = () => {
    const last = items.value.at(-1);
    if (!last) return reload();
    return fetchInto(
      { limit: PAGE_SIZE, beforeAt: Date.parse(last.at), beforeId: last.id },
      (page) => {
        items.value = [...items.value, ...page.items];
      },
    );
  };

  /**
   * Re-fetches as many items as are shown, without a loading state, so an edit or a
   * poll keeps the reader's place in a long list.
   */
  const refresh = () =>
    fetchInto(
      {
        limit: Math.min(MAX_PAGE_SIZE, Math.max(PAGE_SIZE, items.value.length)),
      },
      (page) => {
        items.value = page.items;
      },
      { quiet: true },
    );

  const retry = () => (items.value.length === 0 ? reload() : loadMore());

  return { items, hasMore, total, status, reload, loadMore, refresh, retry };
}

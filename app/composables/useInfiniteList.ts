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
  /** Sent with the first page only; later pages keep the last known total. */
  total?: number;
}

export type InfiniteListStatus = "pending" | "success" | "error";

export type ListPageQuery = { limit: number } & PageCursor;

/**
 * A newest-first list fetched a page at a time. `fetchPage` gets the page size and,
 * for older pages, the cursor of the last item shown. Inside a component the first
 * page loads on mount. Pair with `<InfiniteListEnd :list>`.
 */
export function useInfiniteList<T extends PagedItem>(
  fetchPage: (query: ListPageQuery) => Promise<FetchedPage<T>>,
) {
  const items = ref<T[]>([]) as Ref<T[]>;
  const hasMore = ref(false);
  const total = ref<number | null>(null);
  const status = ref<InfiniteListStatus>("pending");
  let latestRequest = 0;

  async function fetchInto(
    query: ListPageQuery,
    apply: (page: FetchedPage<T>) => void,
  ) {
    const request = ++latestRequest;
    status.value = "pending";
    try {
      const page = await fetchPage(query);
      if (request !== latestRequest) return;
      apply(page);
      hasMore.value = page.hasMore;
      if (page.total !== undefined) total.value = page.total;
      status.value = "success";
    } catch {
      if (request === latestRequest) status.value = "error";
    }
  }

  /**
   * Starts again from the newest page, e.g. after a filter changes. The old items
   * go at once, so nothing from the previous query can be appended to.
   */
  const reload = () => {
    items.value = [];
    hasMore.value = false;
    return fetchInto({ limit: PAGE_SIZE }, (page) => {
      items.value = page.items;
    });
  };

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
   * poll keeps the reader's place in a long list. Skipped while a load is in flight:
   * that load already brings fresh rows, and overtaking it would drop its result.
   */
  async function refresh() {
    if (status.value === "pending") return;
    const request = ++latestRequest;
    try {
      const page = await fetchPage({
        limit: Math.min(MAX_PAGE_SIZE, Math.max(PAGE_SIZE, items.value.length)),
      });
      if (request !== latestRequest) return;
      items.value = page.items;
      hasMore.value = page.hasMore;
      if (page.total !== undefined) total.value = page.total;
      status.value = "success";
    } catch {
      // A failed background refresh leaves the list as it was.
    }
  }

  const retry = () => (items.value.length === 0 ? reload() : loadMore());

  if (getCurrentInstance()) onMounted(reload);

  return { items, hasMore, total, status, reload, loadMore, refresh, retry };
}

export type InfiniteList = Pick<
  ReturnType<typeof useInfiniteList>,
  "status" | "hasMore" | "loadMore" | "retry"
>;

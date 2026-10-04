import type { LocationQuery } from "vue-router";
import { z } from "zod";
import { DEVICE_STATUSES } from "#shared/smart/status";
import { PURPOSES, USAGE_KINDS } from "#shared/usage";
import { VENDORS } from "#shared/vendor";
import { findColumn } from "~/components/inventory/columns";
import {
  ALL,
  INTERFACE_OPTIONS,
  type InventoryFilterState,
  LIFECYCLE_STATES,
  MEDIA_OPTIONS,
  NONE,
  RECORDING_OPTIONS,
  type SingleFacet,
} from "~/components/inventory/filterDisks";
import {
  GROUP_BY_OPTIONS,
  type GroupBy,
} from "~/components/inventory/groupDisks";
import type { SortingState } from "~/components/inventory/types";

export const SEARCH_DEBOUNCE_MS = 300;

export const DEFAULT_SORTING: SortingState = [{ id: "alias", desc: false }];

const NONE_PARAM = "none";

const SINGLE_PARAMS = {
  host: "host",
  pool: "pool",
  usage: "usage",
  purpose: "purpose",
  media: "media",
  interface: "interface",
  recording: "recording",
  vendor: "vendor",
  tag: "tag",
} as const satisfies Record<SingleFacet, string>;

const INVENTORY_PARAMS = [
  "q",
  ...Object.values(SINGLE_PARAMS),
  "state",
  "status",
  "disposed",
  "sort",
  "group",
];

const fromNoneParam = (value: string) => (value === NONE_PARAM ? NONE : value);

const anyName = z.string().min(1).transform(fromNoneParam).catch(ALL);

const oneOf = (values: readonly string[]) =>
  z
    .string()
    .refine((value) => values.includes(value))
    .catch(ALL);

const oneOfOrNone = (values: readonly string[]) =>
  oneOf([...values, NONE_PARAM]).transform(fromNoneParam);

const listOf = <Value extends string>(values: readonly Value[]) =>
  z
    .string()
    .transform((raw) => [
      ...new Set(
        raw
          .split(",")
          .filter((value): value is Value => values.includes(value as Value)),
      ),
    ])
    .catch([]);

const sortParam = z
  .string()
  .transform((raw) => ({
    id: raw.replace(/^-/, ""),
    desc: raw.startsWith("-"),
  }))
  .refine(({ id }) => findColumn(id) !== undefined)
  .transform((primary): SortingState => [primary])
  .catch(DEFAULT_SORTING);

const inventoryQuerySchema = z.object({
  q: z.string().catch(""),
  host: anyName,
  pool: anyName,
  usage: oneOf(USAGE_KINDS),
  purpose: oneOfOrNone(PURPOSES),
  media: oneOfOrNone(MEDIA_OPTIONS),
  interface: oneOfOrNone(INTERFACE_OPTIONS),
  recording: oneOfOrNone(RECORDING_OPTIONS),
  vendor: oneOfOrNone(VENDORS),
  tag: anyName,
  state: listOf(LIFECYCLE_STATES),
  status: listOf(DEVICE_STATUSES),
  disposed: z
    .string()
    .transform((value) => value === "1")
    .catch(false),
  sort: sortParam,
  group: z.enum(GROUP_BY_OPTIONS).nullable().catch(null),
});

const firstValues = (query: LocationQuery) =>
  Object.fromEntries(
    Object.entries(query).map(([key, value]) => [
      key,
      Array.isArray(value) ? value[0] : value,
    ]),
  );

export interface InventoryQueryState {
  filters: InventoryFilterState;
  sorting: SortingState;
  groupBy: GroupBy | null;
}

export function parseInventoryQuery(query: LocationQuery): InventoryQueryState {
  const { q, state, status, disposed, sort, group, ...singles } =
    inventoryQuerySchema.parse(firstValues(query));
  return {
    filters: {
      ...singles,
      search: q,
      states: state,
      statuses: status,
      includeDisposed: disposed,
    },
    sorting: sort,
    groupBy: group,
  };
}

const toSingleParam = (value: string) => {
  if (value === ALL) return undefined;
  return value === NONE ? NONE_PARAM : value;
};

const toSortParam = ([primary]: SortingState) => {
  if (!primary) return undefined;
  const [fallback] = DEFAULT_SORTING;
  if (primary.id === fallback?.id && primary.desc === fallback.desc) {
    return undefined;
  }
  return primary.desc ? `-${primary.id}` : primary.id;
};

export function inventoryQuery({
  filters,
  sorting,
  groupBy,
}: InventoryQueryState): Record<string, string> {
  const params: Record<string, string | undefined> = {
    q: filters.search || undefined,
    ...Object.fromEntries(
      Object.entries(SINGLE_PARAMS).map(([facet, param]) => [
        param,
        toSingleParam(filters[facet as SingleFacet]),
      ]),
    ),
    state: filters.states.join(",") || undefined,
    status: filters.statuses.join(",") || undefined,
    disposed: filters.includeDisposed ? "1" : undefined,
    sort: toSortParam(sorting),
    group: groupBy ?? undefined,
  };
  return Object.fromEntries(
    Object.entries(params).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
}

const sameSelects = (left: InventoryFilterState, right: InventoryFilterState) =>
  JSON.stringify(
    inventoryQuery({
      filters: { ...left, search: "" },
      sorting: [],
      groupBy: null,
    }),
  ) ===
  JSON.stringify(
    inventoryQuery({
      filters: { ...right, search: "" },
      sorting: [],
      groupBy: null,
    }),
  );

export function useInventoryQuery() {
  const route = useRoute();
  const router = useRouter();

  const fromRoute = computed(() => parseInventoryQuery(route.query));

  const search = ref(fromRoute.value.filters.search);
  let pendingSearch: ReturnType<typeof setTimeout> | undefined;

  const cancelPendingSearch = () => {
    clearTimeout(pendingSearch);
    pendingSearch = undefined;
  };

  watch(
    () => fromRoute.value.filters.search,
    (routeSearch) => {
      if (pendingSearch === undefined) search.value = routeSearch;
    },
  );

  const queryFor = (state: InventoryQueryState) => {
    const unrelated = Object.fromEntries(
      Object.entries(route.query).filter(
        ([key]) => !INVENTORY_PARAMS.includes(key),
      ),
    );
    return { ...unrelated, ...inventoryQuery(state) };
  };

  const navigate = (state: InventoryQueryState) => {
    cancelPendingSearch();
    return router.push({ query: queryFor(state) });
  };

  const scheduleSearch = () => {
    cancelPendingSearch();
    pendingSearch = setTimeout(() => {
      pendingSearch = undefined;
      router.replace({
        query: queryFor({
          ...fromRoute.value,
          filters: { ...fromRoute.value.filters, search: search.value },
        }),
      });
    }, SEARCH_DEBOUNCE_MS);
  };

  onScopeDispose(cancelPendingSearch);

  const filters = computed<InventoryFilterState>({
    get: () => ({ ...fromRoute.value.filters, search: search.value }),
    set: (next) => {
      const searchChanged = next.search !== search.value;
      search.value = next.search;
      if (!sameSelects(next, fromRoute.value.filters)) {
        navigate({ ...fromRoute.value, filters: next });
      } else if (searchChanged) {
        scheduleSearch();
      }
    },
  });

  const sorting = computed<SortingState>({
    get: () => fromRoute.value.sorting,
    set: (next) =>
      navigate({ ...fromRoute.value, filters: filters.value, sorting: next }),
  });

  const groupBy = computed<GroupBy | null>({
    get: () => fromRoute.value.groupBy,
    set: (next) =>
      navigate({ ...fromRoute.value, filters: filters.value, groupBy: next }),
  });

  return { filters, sorting, groupBy };
}

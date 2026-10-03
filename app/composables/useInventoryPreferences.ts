import { z } from "zod";
import { findColumn, INVENTORY_COLUMNS } from "~/components/inventory/columns";

export const INVENTORY_PREFERENCES_COOKIE = "inventory.prefs";

const COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

export const INVENTORY_VIEWS = ["table", "cards"] as const;

export type InventoryView = (typeof INVENTORY_VIEWS)[number];

const preferencesSchema = z.object({
  columns: z.record(z.string(), z.boolean()).catch({}),
  view: z.enum(INVENTORY_VIEWS).catch("table"),
});

type InventoryPreferences = z.infer<typeof preferencesSchema>;

const isHideable = (id: string) => {
  const column = findColumn(id);
  return column !== undefined && !column.locked;
};

const parsePreferences = (raw: unknown): InventoryPreferences => {
  const parsed = preferencesSchema.safeParse(raw);
  if (!parsed.success) return { columns: {}, view: "table" };
  const columns = Object.fromEntries(
    Object.entries(parsed.data.columns).filter(([id]) => isHideable(id)),
  );
  return { columns, view: parsed.data.view };
};

export function useInventoryPreferences() {
  const cookie = useCookie<unknown>(INVENTORY_PREFERENCES_COOKIE, {
    default: () => ({}),
    maxAge: COOKIE_MAX_AGE_SECONDS,
    sameSite: "lax",
  });

  const preferences = computed(() => parsePreferences(cookie.value));

  const visibleColumns = computed<ReadonlySet<string>>(
    () =>
      new Set(
        INVENTORY_COLUMNS.filter(
          ({ id, locked, defaultVisible }) =>
            locked || (preferences.value.columns[id] ?? defaultVisible),
        ).map(({ id }) => id),
      ),
  );

  const save = (patch: Partial<InventoryPreferences>) => {
    cookie.value = { ...preferences.value, ...patch };
  };

  const setColumnVisible = (id: string, visible: boolean) => {
    const column = findColumn(id);
    if (!column || column.locked) return;
    const { [id]: _previous, ...columns } = preferences.value.columns;
    save({
      columns:
        visible === column.defaultVisible
          ? columns
          : { ...columns, [id]: visible },
    });
  };

  const resetColumns = () => save({ columns: {} });

  const isCustomised = computed(
    () => Object.keys(preferences.value.columns).length > 0,
  );

  const view = computed<InventoryView>({
    get: () => preferences.value.view,
    set: (view) => save({ view }),
  });

  return {
    visibleColumns,
    setColumnVisible,
    resetColumns,
    isCustomised,
    view,
  };
}

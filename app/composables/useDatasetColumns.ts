import { z } from "zod";
import {
  DATASET_COLUMNS,
  findDatasetColumn,
} from "~/components/dataset/columns";

export const DATASET_COLUMNS_COOKIE = "datasets.columns";

const COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

const choicesSchema = z.record(z.string(), z.boolean());

const isHideable = (id: string) => {
  const column = findDatasetColumn(id);
  return column !== undefined && !column.locked;
};

const parseChoices = (raw: unknown): Record<string, boolean> => {
  const parsed = choicesSchema.safeParse(raw);
  if (!parsed.success) return {};
  return Object.fromEntries(
    Object.entries(parsed.data).filter(([id]) => isHideable(id)),
  );
};

export function useDatasetColumns() {
  const cookie = useCookie<unknown>(DATASET_COLUMNS_COOKIE, {
    default: () => ({}),
    maxAge: COOKIE_MAX_AGE_SECONDS,
    sameSite: "lax",
  });

  const choices = computed(() => parseChoices(cookie.value));

  const visibleColumns = computed(() =>
    DATASET_COLUMNS.filter(
      ({ id, locked, defaultVisible }) =>
        locked || (choices.value[id] ?? defaultVisible),
    ),
  );

  const setColumnVisible = (id: string, visible: boolean) => {
    const column = findDatasetColumn(id);
    if (!column || column.locked) return;
    const { [id]: _previous, ...others } = choices.value;
    cookie.value =
      visible === column.defaultVisible ? others : { ...others, [id]: visible };
  };

  const resetColumns = () => {
    cookie.value = {};
  };

  const isCustomised = computed(() => Object.keys(choices.value).length > 0);

  return { visibleColumns, setColumnVisible, resetColumns, isCustomised };
}

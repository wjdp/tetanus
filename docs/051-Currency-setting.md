---
type: task
status: todo
---

# Currency setting

`inventory.purchasePrice` is a bare number (`z.number().nonnegative()`, major
units). The only place it renders, `DiskInventoryForm.vue`, hard-codes a `£`
prefix and `step="0.01"`. [050](050-Disk-list-columns-and-views.md) adds Price and
price-per-TB columns, so formatting needs one source of truth before they ship.

## Model

One global display currency, ISO 4217 code, default `GBP`. No per-disk currency,
no conversion: single user, one household, prices entered in their own money.
Stored numbers stay as they are; changing the setting relabels, it does not
convert (copy on the setting says so).

- `settingsConfigSchema` gains `currency: z.string().length(3).toUpperCase()
  .refine(in Intl.supportedValuesOf("currency"))` (length before the transform,
  refine after); `DEFAULT_SETTINGS_CONFIG` `currency: "GBP"`. `settingsPatchSchema`
  is a hand-listed `strictObject`: add `currency` there explicitly. Settings is a JSON config
  row, so no migration; existing rows read the default via the schema default.
- `useCurrency()` composable over `useFetch("/api/settings", { key: "settings" })`,
  deduped with the home and settings pages' fetch. No new endpoint: no UI auth,
  the enrol token is already client-visible.

## Formatting

`shared/money.ts`:

- `formatMoney(amount, currency)` → `Intl.NumberFormat("en-GB", { style:
  "currency", currency, currencyDisplay: "narrowSymbol" })` (`$` not `US$`). `en-GB` locale like the rest of the app
  (`toLocaleString("en-GB")`); the currency code picks the symbol.
- `currencySymbol(currency)` and `currencyStep(currency)` from
  `resolvedOptions().maximumFractionDigits` (JPY → `1`, GBP → `0.01`).
- `formatMoneyPerTb(amount, capacityBytes, currency)` for 050's column; label
  `{symbol}/TB`.

## UI

- Settings › General: currency `USelectMenu`, searchable, items from
  `Intl.supportedValuesOf("currency")` with `Intl.DisplayNames` names
  (`GBP — British pound`).
- `DiskInventoryForm`: leading symbol and `step` from the setting.
- 050 Price and price-per-TB columns use `formatMoney`.

## Tests

- `money`: GBP, USD, EUR, JPY formatting; step per currency; per-TB maths and
  null capacity.
- Settings schema: default applied to old config; invalid code rejected.
- Settings page: saving currency patches config.
- Inventory form: symbol follows setting.

## Questions

- Ever need per-disk currency (bought abroad)? Assumed no.

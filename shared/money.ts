export const DEFAULT_CURRENCY = "GBP";

const BYTES_PER_TB = 1e12;

const formatters = new Map<string, Intl.NumberFormat>();

function currencyFormat(currency: string): Intl.NumberFormat {
  let formatter = formatters.get(currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
    });
    formatters.set(currency, formatter);
  }
  return formatter;
}

export function isSupportedCurrency(code: string): boolean {
  return Intl.supportedValuesOf("currency").includes(code);
}

export function formatMoney(amount: number, currency: string): string {
  return currencyFormat(currency).format(amount);
}

export function currencySymbol(currency: string): string {
  return (
    currencyFormat(currency)
      .formatToParts(0)
      .find((part) => part.type === "currency")?.value ?? currency
  );
}

export function currencyStep(currency: string): string {
  const { maximumFractionDigits = 0 } =
    currencyFormat(currency).resolvedOptions();
  return maximumFractionDigits === 0
    ? "1"
    : `0.${"0".repeat(maximumFractionDigits - 1)}1`;
}

export function moneyPerTb(
  amount: number | null,
  capacityBytes: number | null,
): number | null {
  if (amount === null || !capacityBytes) return null;
  return amount / (capacityBytes / BYTES_PER_TB);
}

export function formatMoneyPerTb(
  amount: number | null,
  capacityBytes: number | null,
  currency: string,
): string | null {
  const perTb = moneyPerTb(amount, capacityBytes);
  return perTb === null ? null : formatMoney(perTb, currency);
}

export function moneyPerTbLabel(currency: string): string {
  return `${currencySymbol(currency)}/TB`;
}

export interface CurrencyItem {
  label: string;
  value: string;
}

export function currencyItems(): CurrencyItem[] {
  const names = new Intl.DisplayNames("en-GB", { type: "currency" });
  return Intl.supportedValuesOf("currency").map((code) => ({
    label: `${code}: ${names.of(code) ?? code}`,
    value: code,
  }));
}

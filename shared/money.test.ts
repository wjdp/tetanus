import { describe, expect, it } from "vitest";
import {
  currencyItems,
  currencyStep,
  currencySymbol,
  formatMoney,
  formatMoneyPerTb,
  isSupportedCurrency,
  moneyPerTb,
  moneyPerTbLabel,
} from "./money";

describe("formatMoney", () => {
  it.each([
    ["GBP", 1234.5, "£1,234.50"],
    ["USD", 1234.5, "$1,234.50"],
    ["EUR", 1234.5, "€1,234.50"],
    ["JPY", 1234.5, "¥1,235"],
  ])("formats %s", (currency, amount, expected) => {
    expect(formatMoney(amount, currency)).toBe(expected);
  });
});

describe("currencySymbol", () => {
  it.each([
    ["GBP", "£"],
    ["USD", "$"],
    ["EUR", "€"],
    ["JPY", "¥"],
  ])("gives the narrow symbol for %s", (currency, expected) => {
    expect(currencySymbol(currency)).toBe(expected);
  });
});

describe("currencyStep", () => {
  it.each([
    ["GBP", "0.01"],
    ["USD", "0.01"],
    ["JPY", "1"],
    ["BHD", "0.001"],
  ])("steps %s by %s", (currency, expected) => {
    expect(currencyStep(currency)).toBe(expected);
  });
});

describe("isSupportedCurrency", () => {
  it("accepts ISO 4217 codes and rejects others", () => {
    expect(isSupportedCurrency("GBP")).toBe(true);
    expect(isSupportedCurrency("XYZ")).toBe(false);
  });
});

describe("per TB", () => {
  it("divides the price by decimal terabytes", () => {
    expect(moneyPerTb(240, 12e12)).toBe(20);
    expect(formatMoneyPerTb(240, 12e12, "GBP")).toBe("£20.00");
  });

  it("is null without a price or capacity", () => {
    expect(moneyPerTb(240, null)).toBeNull();
    expect(moneyPerTb(240, 0)).toBeNull();
    expect(moneyPerTb(null, 12e12)).toBeNull();
    expect(formatMoneyPerTb(240, null, "GBP")).toBeNull();
  });

  it("labels the column with the symbol", () => {
    expect(moneyPerTbLabel("USD")).toBe("$/TB");
  });
});

describe("currencyItems", () => {
  it("labels each code with its British English name", () => {
    expect(currencyItems()).toContainEqual({
      label: "GBP: British Pound",
      value: "GBP",
    });
  });
});

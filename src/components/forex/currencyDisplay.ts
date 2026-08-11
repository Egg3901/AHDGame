import type { CurrencyCode } from "@/lib/constants/currencies";

export const CURRENCY_COLORS: Partial<Record<CurrencyCode, string>> = {
  USD: "var(--color-primary)",
  GBP: "var(--color-success)",
  JPY: "var(--color-warning)",
  CAD: "var(--color-error)",
  EUR: "#6366f1",
  CNY: "#dc2626",
  BRL: "#14b8a6",
};

export const CURRENCY_FLAG_CODE: Partial<Record<CurrencyCode, string>> = {
  USD: "us",
  GBP: "gb",
  JPY: "jp",
  CAD: "ca",
  EUR: "eu",
  CNY: "cn",
  BRL: "br",
};

export const CURRENCY_NAMES: Record<string, string> = {
  USD: "US Dollar",
  GBP: "British Pound",
  JPY: "Japanese Yen",
  CAD: "Canadian Dollar",
  EUR: "Euro",
  CNY: "Chinese Yuan",
  BRL: "Brazilian Real",
};

import { describe, expect, it } from "vitest";
import { openingFiscalBooks1991 } from "@/lib/resetFinance/opening1991";
import { openingNationalFiscalObservations1991 } from "./openingSeed1991";

describe("balanced 1991 reset fiscal observations", () => {
  const fiscal = openingFiscalBooks1991();
  const observations = openingNationalFiscalObservations1991();

  it.each(["US", "UK", "JP"] as const)(
    "%s reports its funded opening balance and corrected historical debt",
    (country) => {
      const book = fiscal[country];
      expect(observations[country].balance.value).toBe((book.annualBalance / book.gdp) * 100);
      expect(observations[country].balance.value).toBeGreaterThanOrEqual(-0.5);
      expect(observations[country].debt.value).toBe((book.debt / book.gdp) * 100);
    }
  );
});

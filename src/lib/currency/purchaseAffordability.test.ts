import { describe, expect, it } from "vitest";
import {
  estimateExplicitPayCoverage,
  estimateImplicitAutoConvertCoverage,
} from "@/lib/currency/purchaseAffordability";
import { MARKET_MAKER_SPREAD, type CurrencyCode } from "@/lib/constants/currencies";

function legacyOnePassImplicit(
  requiredAmount: number,
  balances: Partial<Record<CurrencyCode, number>>
) {
  const rates: Partial<Record<CurrencyCode, number>> = { USD: 1, EUR: 0.92 };
  const targetCurrency = "USD" as CurrencyCode;
  const sourceCurrency = "EUR" as CurrencyCode;
  let spendableInTarget = balances[targetCurrency] ?? 0;
  const sourceBalance = balances[sourceCurrency] ?? 0;
  const crossRate = rates[targetCurrency]! / rates[sourceCurrency]!;
  const shortfall = requiredAmount - spendableInTarget;
  const idealSpend = shortfall / ((1 - MARKET_MAKER_SPREAD) * crossRate);
  const spendAmount = Math.min(sourceBalance, idealSpend);
  const spreadFee = Math.round(spendAmount * MARKET_MAKER_SPREAD);
  const delivered = Math.round((spendAmount - spreadFee) * crossRate);
  spendableInTarget += delivered;
  return spendableInTarget;
}

describe("purchaseAffordability", () => {
  it("iterates implicit auto-convert until a rounding edge is actually covered", () => {
    const rates: Partial<Record<CurrencyCode, number>> = { USD: 1, EUR: 0.92 };
    const balances: Partial<Record<CurrencyCode, number>> = {
      USD: 0,
      EUR: 977966,
    };

    let foundRequirement: number | null = null;
    for (let requiredAmount = 900_000; requiredAmount <= 1_100_000; requiredAmount++) {
      const legacySpendable = legacyOnePassImplicit(requiredAmount, balances);
      const current = estimateImplicitAutoConvertCoverage({
        requiredAmount,
        targetCurrency: "USD",
        balances,
        rates,
      });
      if (legacySpendable < requiredAmount && (current?.spendableInTarget ?? 0) >= requiredAmount) {
        foundRequirement = requiredAmount;
        break;
      }
    }

    expect(foundRequirement).not.toBeNull();
  });

  it("returns spendableInTarget without rates when target balance already covers the requirement", () => {
    // Repro for bonds buy bug: a US character buying a USD bond should never
    // be marked short during the modal's exchange-rate-fetch race window when
    // their USD wallet alone can cover the cost. The estimator must short-
    // circuit before reaching the `if (!rates[targetCurrency]) return null`
    // guard. See src/app/bond/[id]/page.tsx affordability flow.
    const balances: Partial<Record<CurrencyCode, number>> = {
      USD: 100_000,
      EUR: 50_000,
    };

    const estimate = estimateImplicitAutoConvertCoverage({
      requiredAmount: 50_000,
      targetCurrency: "USD",
      balances,
      rates: {}, // simulate first render before /api/forex/* responds
    });

    expect(estimate).not.toBeNull();
    expect(estimate?.spendableInTarget).toBeGreaterThanOrEqual(50_000);
  });

  it("still returns null when conversion is needed but rates are missing", () => {
    // Defence-in-depth: if the user does not have enough in the target
    // currency directly, we still cannot estimate without rates. Returning
    // null here preserves the existing 'show fallback' branches in the modal.
    const balances: Partial<Record<CurrencyCode, number>> = {
      USD: 1_000,
      EUR: 200_000,
    };

    const estimate = estimateImplicitAutoConvertCoverage({
      requiredAmount: 50_000,
      targetCurrency: "USD",
      balances,
      rates: {},
    });

    expect(estimate).toBeNull();
  });

  it("covers Ariane #2's $0.13-residue case: existing target balance + plenty of source", () => {
    // Live repro: DE character with USD personal=732.87, EUR personal=791,425
    // tries to buy 1 unit of a $1,000 USD bond with auto-convert on. The
    // naive iteration delivers 267 USD on the first pass (residue from
    // shortfall/(1-spread)/crossRate rounding), leaving spendable=999.87,
    // and the second iteration's 0.19 EUR rounds to 0 USD so the loop gives
    // up "$0.13 short". With the rounding-buffer bump the first pass
    // overshoots by < 1 source unit and covers the requirement.
    const rates: Partial<Record<CurrencyCode, number>> = {
      USD: 0.7166649174394811,
      EUR: 1.0527345155291137,
    };
    const balances: Partial<Record<CurrencyCode, number>> = {
      USD: 732.8667418062687,
      EUR: 791_425.0021552118,
      GBP: 0,
      JPY: 0,
    };

    const estimate1 = estimateImplicitAutoConvertCoverage({
      requiredAmount: 1_000,
      targetCurrency: "USD",
      balances,
      rates,
    });
    expect(estimate1?.spendableInTarget ?? 0).toBeGreaterThanOrEqual(1_000);

    // Same residue applied at scale: 17-unit purchase ($17,000) should not
    // also strand the user $0.13 short.
    const estimate17 = estimateImplicitAutoConvertCoverage({
      requiredAmount: 17_000,
      targetCurrency: "USD",
      balances,
      rates,
    });
    expect(estimate17?.spendableInTarget ?? 0).toBeGreaterThanOrEqual(17_000);
  });

  it("treats explicit FX pay as affordable when the available balance can cover after clamp + rounding", () => {
    const rates: Partial<Record<CurrencyCode, number>> = { USD: 1, EUR: 0.92 };

    let foundRequirement: number | null = null;
    for (let requiredAmount = 1; requiredAmount <= 250_000; requiredAmount++) {
      const estimate = estimateExplicitPayCoverage({
        requiredAmount,
        fromCurrency: "EUR",
        toCurrency: "USD",
        availableBalance: 100_000,
        rates,
      });
      if (!estimate) continue;
      if (estimate.requiredFromAmount > 100_000 && estimate.canAfford) {
        foundRequirement = requiredAmount;
        break;
      }
    }

    expect(foundRequirement).not.toBeNull();
  });
});

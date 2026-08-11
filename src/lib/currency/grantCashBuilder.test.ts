import { describe, it, expect } from "vitest";
import {
  buildHomeCurrencyCashGrantSetStage,
  buildCampaignFundsGrantExpression,
} from "./grantCashBuilder";

/**
 * Minimal evaluator for the subset of MongoDB aggregation operators the grant
 * builder emits ($cond / $eq / $add / $ifNull). Walks the expression for a given
 * character so tests assert on resulting balances (behavior) rather than the
 * brittle shape of the pipeline object.
 */
function evalExpr(expr: unknown, character: Record<string, unknown>): unknown {
  if (expr === null || typeof expr !== "object") return expr;
  const obj = expr as Record<string, unknown>;

  if (typeof obj === "object" && "$ifNull" in obj) {
    const [val, fallback] = obj.$ifNull as [unknown, unknown];
    const resolved = evalExpr(val, character);
    return resolved === null || resolved === undefined ? evalExpr(fallback, character) : resolved;
  }
  if ("$cond" in obj) {
    const cond = obj.$cond as { if: unknown; then: unknown; else: unknown };
    return evalExpr(cond.if, character)
      ? evalExpr(cond.then, character)
      : evalExpr(cond.else, character);
  }
  if ("$eq" in obj) {
    const [a, b] = obj.$eq as [unknown, unknown];
    return evalExpr(a, character) === evalExpr(b, character);
  }
  if ("$add" in obj) {
    return (obj.$add as unknown[]).reduce<number>(
      (sum, e) => sum + (evalExpr(e, character) as number),
      0
    );
  }
  return expr;
}

/** Resolve a "$field.path" reference against a character document. */
function resolveField(ref: string, character: Record<string, unknown>): unknown {
  const path = ref.slice(1).split(".");
  let cur: unknown = character;
  for (const seg of path) {
    if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

/** Evaluate a single currency path's expression to a number for a given character. */
function evalPath(
  setStage: Record<string, unknown>,
  path: string,
  character: Record<string, unknown>
) {
  // Replace "$field" string refs with their resolved values during walk.
  const withRefs = (expr: unknown): unknown => {
    if (typeof expr === "string" && expr.startsWith("$")) return resolveField(expr, character);
    if (Array.isArray(expr)) return expr.map(withRefs);
    if (expr && typeof expr === "object") {
      return Object.fromEntries(Object.entries(expr).map(([k, v]) => [k, withRefs(v)]));
    }
    return expr;
  };
  return evalExpr(withRefs(setStage[path]), character);
}

describe("buildHomeCurrencyCashGrantSetStage", () => {
  // DE → EUR, IE → IEP (distinct currencies with independent rates).
  const rates = new Map<string, number>([
    ["US", 1.0],
    ["UK", 0.75],
    ["JP", 106],
    ["DE", 1.108],
    ["IE", 0.357],
    ["BR", 5],
    ["CN", 7.2],
  ]);
  const GRANT = 10_000_000;

  const EUR_RATE = 1.108;
  const IEP_RATE = 0.357;

  it("credits DE players (the collision bug zeroed them out)", () => {
    const setStage = buildHomeCurrencyCashGrantSetStage(GRANT, rates);
    const de = { countryId: "DE", currencyBalances: { personal: { EUR: 1_012_000 } } };
    const result = evalPath(setStage, "currencyBalances.personal.EUR", de);
    expect(result).toBeCloseTo(1_012_000 + GRANT * EUR_RATE, 2);
  });

  it("credits IE players in the IEP bucket at the IEP rate", () => {
    const setStage = buildHomeCurrencyCashGrantSetStage(GRANT, rates);
    const ie = { countryId: "IE", currencyBalances: { personal: { IEP: 500_000 } } };
    const result = evalPath(setStage, "currencyBalances.personal.IEP", ie);
    expect(result).toBeCloseTo(500_000 + GRANT * IEP_RATE, 2);
  });

  it("leaves the EUR bucket untouched for a non-EUR (US) player", () => {
    const setStage = buildHomeCurrencyCashGrantSetStage(GRANT, rates);
    const us = { countryId: "US", currencyBalances: { personal: { EUR: 7_777 } } };
    const result = evalPath(setStage, "currencyBalances.personal.EUR", us);
    expect(result).toBe(7_777);
  });

  it("credits a single-currency country (US -> USD) at its rate", () => {
    const setStage = buildHomeCurrencyCashGrantSetStage(GRANT, rates);
    const us = { countryId: "US", currencyBalances: { personal: { USD: 0 } } };
    const result = evalPath(setStage, "currencyBalances.personal.USD", us);
    expect(result).toBeCloseTo(GRANT * 1.0, 2);
  });

  it("treats a missing personal bucket as zero before adding", () => {
    const setStage = buildHomeCurrencyCashGrantSetStage(GRANT, rates);
    const jp = { countryId: "JP", currencyBalances: { personal: {} } };
    const result = evalPath(setStage, "currencyBalances.personal.JPY", jp);
    expect(result).toBeCloseTo(GRANT * 106, 2);
  });
});

describe("buildCampaignFundsGrantExpression", () => {
  const rates = new Map<string, number>([
    ["US", 1.0],
    ["UK", 0.75],
    ["JP", 106],
    ["DE", 1.108],
    ["IE", 0.357],
    ["BR", 5],
    ["CN", 7.2],
  ]);
  const FUNDS = 1_000_000;
  const EUR_RATE = 1.108;
  const IEP_RATE = 0.357;

  function evalCampaign(expr: unknown, character: Record<string, unknown>) {
    const setStage = { "currencyBalances.campaign": expr };
    return evalPath(setStage, "currencyBalances.campaign", character);
  }

  it("converts DE campaign funds at the EUR rate", () => {
    const expr = buildCampaignFundsGrantExpression(FUNDS, rates);
    const de = { countryId: "DE", currencyBalances: { campaign: 624_474 } };
    expect(evalCampaign(expr, de)).toBeCloseTo(624_474 + FUNDS * EUR_RATE, 2);
  });

  it("converts IE campaign funds at the IEP rate", () => {
    const expr = buildCampaignFundsGrantExpression(FUNDS, rates);
    const ie = { countryId: "IE", currencyBalances: { campaign: 0 } };
    expect(evalCampaign(expr, ie)).toBeCloseTo(FUNDS * IEP_RATE, 2);
  });

  it("converts US campaign funds at the USD rate", () => {
    const expr = buildCampaignFundsGrantExpression(FUNDS, rates);
    const us = { countryId: "US", currencyBalances: { campaign: 100 } };
    expect(evalCampaign(expr, us)).toBeCloseTo(100 + FUNDS * 1.0, 2);
  });

  it("treats a missing campaign balance as zero", () => {
    const expr = buildCampaignFundsGrantExpression(FUNDS, rates);
    const jp = { countryId: "JP", currencyBalances: {} };
    expect(evalCampaign(expr, jp)).toBeCloseTo(FUNDS * 106, 2);
  });
});

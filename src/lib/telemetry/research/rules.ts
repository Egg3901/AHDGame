/**
 * Portable rules core for the research panels (#2331, #2332, #2333, #2336).
 *
 * Pure data in, plain data out: no database, no wall clock, no randomness, no
 * environment. The turn shells (`countryTurn.ts`, `trade.ts`, `securities.ts`)
 * read live state, pass the observation time in explicitly, and write the rows
 * these builders return. The export shell (`export.ts`) reads rows back and
 * hands them to the panel builders below.
 *
 * Every series extends the long-horizon telemetry contract (#2100): rows carry
 * world identity, source class, sim-run provenance (run id, seed, executed
 * revision), the raw turn and in-game year, the founding-turn flag and an
 * explicit `world-raw-full` retention label. Missing values are `null` and are
 * listed in `missing`; nothing absent is ever written as zero.
 */
import {
  LONG_HORIZON_RETENTION_POLICY_ID,
  LONG_HORIZON_RETENTION_POLICY_VERSION,
  type LongHorizonSourceClass,
} from "@/lib/telemetry/longHorizon/rules";

/** Shape version of every research row. Bump on field changes. */
export const RESEARCH_TELEMETRY_SCHEMA_VERSION = 1;

/**
 * Calculation versions, one per family. Bump whenever the meaning of a
 * recorded field changes so a series spanning the change stays interpretable.
 */
export const COUNTRY_TURN_CALC_VERSION = 1;
export const TRADE_PANEL_CALC_VERSION = 1;
export const SECURITY_PANEL_CALC_VERSION = 1;
export const ANNUAL_FISCAL_CALC_VERSION = 1;

/** Run-level provenance shared by every research row. */
export interface ResearchProvenance {
  worldId: string;
  sourceClass: LongHorizonSourceClass;
  runId?: string;
  seed?: string;
  codeVersion?: string;
  turn: number;
  year: number;
  foundingTurn: boolean;
  /** Actual UTC time the row was observed (written at the end of the turn). */
  observedAt: Date;
  schemaVersion: number;
  calcVersion: number;
  retentionPolicy: string;
  retentionVersion: number;
}

export type ResearchProvenanceInput = Omit<
  ResearchProvenance,
  "schemaVersion" | "calcVersion" | "retentionPolicy" | "retentionVersion"
>;

function stampProvenance(input: ResearchProvenanceInput, calcVersion: number): ResearchProvenance {
  return {
    worldId: input.worldId,
    sourceClass: input.sourceClass,
    ...(input.runId !== undefined ? { runId: input.runId } : {}),
    ...(input.seed !== undefined ? { seed: input.seed } : {}),
    ...(input.codeVersion !== undefined ? { codeVersion: input.codeVersion } : {}),
    turn: input.turn,
    year: input.year,
    foundingTurn: input.foundingTurn,
    observedAt: input.observedAt,
    schemaVersion: RESEARCH_TELEMETRY_SCHEMA_VERSION,
    calcVersion,
    retentionPolicy: LONG_HORIZON_RETENTION_POLICY_ID,
    retentionVersion: LONG_HORIZON_RETENTION_POLICY_VERSION,
  };
}

/** Finite number or null. Absence is never coerced to zero. */
export function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function ratioOrNull(numerator: number, denominator: number): number | null {
  return denominator > 0 && Number.isFinite(numerator) ? numerator / denominator : null;
}

function round(value: number, places = 4): number {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

// ── Country-turn macro, monetary and fiscal panel (#2331, #2336) ─────────────

/**
 * Who set the policy rate. `government`: the head of government or finance
 * seat (pre-independence regimes). `committee`: a seated FOMC-style board.
 * `chair`: a single player chair. `autonomous-chair`: no player holds the
 * chair, so the autonomous technocrat rule sets the rate.
 */
export type PolicyAuthority = "government" | "committee" | "chair" | "autonomous-chair";
export type RateDecision = "hike" | "cut" | "hold";

export interface PolicyAuthorityInput {
  governmentControlled: boolean;
  hasCommittee: boolean;
  chairIsPlayer: boolean;
}

export function classifyPolicyAuthority(input: PolicyAuthorityInput): PolicyAuthority {
  if (input.governmentControlled) return "government";
  if (input.hasCommittee) return "committee";
  return input.chairIsPlayer ? "chair" : "autonomous-chair";
}

/** Rate decision for a turn from the last executed change, if it landed this turn. */
export function classifyRateDecision(change: { previousRate: number; newRate: number } | null): {
  decision: RateDecision;
  delta: number;
} {
  if (!change) return { decision: "hold", delta: 0 };
  const delta = round(change.newRate - change.previousRate, 6);
  if (delta > 0) return { decision: "hike", delta };
  if (delta < 0) return { decision: "cut", delta };
  return { decision: "hold", delta: 0 };
}

/** Denominator source of the reported debt/GDP ratio (see `sovereignDebtTerms`). */
export type DebtRatioDenominator = "gdpSmoothed" | "gdp";

/** `sovereignDebtTerms` divides by the smoothed GDP when positive, else raw GDP. */
export function debtRatioDenominator(
  gdp: number | null,
  gdpSmoothed: number | null
): { source: DebtRatioDenominator; value: number } | null {
  if (gdpSmoothed !== null && gdpSmoothed > 0) return { source: "gdpSmoothed", value: gdpSmoothed };
  if (gdp !== null && gdp > 0) return { source: "gdp", value: gdp };
  return null;
}

export interface CountryTurnMacro {
  /** Annual %, from `federalBudget.economicFactors.inflationRate`. */
  inflationRate: number | null;
  /** Annual %, era-aware target the autonomous chair steers toward. */
  targetInflation: number | null;
  /** Annual %, spot policy rate. */
  primeRate: number | null;
  /** Annual %, EMA of the prime rate: the lagged effective rate equities price off. */
  effectiveRate: number | null;
  /** Annual %, national GDP growth as snapshotted for the central bank. */
  gdpGrowth: number | null;
  /** GDP-weighted mean of regional output gaps (%). */
  outputGap: number | null;
  /** Population-weighted mean of regional unemployment rates (%). */
  unemploymentRate: number | null;
  /** Annual %, from the federal budget economic factors. */
  wageGrowth: number | null;
  /** Annual %, from the federal budget economic factors. */
  tradeGrowth: number | null;
  /** Local currency, national GDP level (sum of regions x 1M). */
  gdp: number | null;
}

export interface CountryTurnMonetary {
  authority: PolicyAuthority | null;
  decision: RateDecision | null;
  /** Policy-rate change executed this turn (pp); 0 on a hold. */
  rateChange: number | null;
  /** Whether the executed change came from a player or the system rule. */
  rateChangeActor: "player" | "system" | null;
  lastRateChangeTurn: number | null;
  /** Latest autonomous monetary-operation decision when evaluated this turn. */
  operationDecision: string | null;
  fxRegime: string | null;
  monetaryRegime: string | null;
  capitalControls: boolean | null;
  /** Local currency units per anchor unit. */
  exchangeRate: number | null;
}

export interface CountryTurnFiscal {
  fiscalYear: number | null;
  /** Annual budget figures, local currency. Recomputed at fiscal close and on tax changes. */
  revenueTotal: number | null;
  revenueBySource: Record<string, number>;
  spendingTotal: number | null;
  spendingByCategory: Record<string, number>;
  stateGrants: number | null;
  debtInterest: number | null;
  /** surplus + debtInterest: the balance before interest. */
  primaryBalance: number | null;
  surplus: number | null;
  treasuryBalance: number | null;
  /** Closing sovereign principal: outstanding bond stock at end of turn. */
  debtPrincipal: number | null;
  debtInterestRate: number | null;
  debtToGdpRatio: number | null;
  debtToGdpDenominator: DebtRatioDenominator | null;
  debtToGdpDenominatorValue: number | null;
  creditRating: string | null;
  /** Sovereign face issued, redeemed and repudiated this turn (bond ledger). */
  sovereignIssuedFace: number;
  sovereignRetiredFace: number;
  sovereignDefaultedFace: number;
  /** Coupon due this turn on outstanding non-defaulted sovereign face. */
  sovereignScheduledCoupon: number;
}

export interface CountryTurnRow extends ResearchProvenance {
  country: string;
  currencyCode: string | null;
  macro: CountryTurnMacro;
  monetary: CountryTurnMonetary;
  fiscal: CountryTurnFiscal;
  events: { atWar: boolean; conflictIds: string[] };
  /** Dotted paths of every field that was unavailable this turn. */
  missing: string[];
}

export interface CountryTurnInput extends ResearchProvenanceInput {
  country: string;
  currencyCode?: string | null;
  macro: Partial<Record<keyof CountryTurnMacro, unknown>>;
  monetary: {
    governmentControlled?: boolean;
    hasCommittee?: boolean;
    chairIsPlayer?: boolean;
    hasBank: boolean;
    lastRateChangeTurn?: unknown;
    /** The last executed change, only when it landed this turn. */
    changeThisTurn?: { previousRate: number; newRate: number; bySystem: boolean } | null;
    operationDecision?: string | null;
    fxRegime?: string | null;
    monetaryRegime?: string | null;
    capitalControls?: boolean | null;
    exchangeRate?: unknown;
  };
  fiscal: {
    hasBudget: boolean;
    fiscalYear?: unknown;
    revenue?: Record<string, unknown> | null;
    spending?: {
      byCategory?: Record<string, unknown>;
      stateGrants?: unknown;
      debtInterest?: unknown;
      total?: unknown;
    } | null;
    surplus?: unknown;
    treasuryBalance?: unknown;
    debtPrincipal?: unknown;
    debtInterestRate?: unknown;
    debtToGdpRatio?: unknown;
    gdpSmoothed?: unknown;
    creditRating?: string | null;
    issuedFace: number;
    retiredFace: number;
    defaultedFace: number;
    scheduledCoupon: number;
  };
  conflictIds: string[];
}

function numericRecord(source: Record<string, unknown> | null | undefined, skip: Set<string>) {
  const out: Record<string, number> = {};
  if (!source) return out;
  for (const [key, value] of Object.entries(source)) {
    if (skip.has(key)) continue;
    const n = finiteOrNull(value);
    if (n !== null) out[key] = n;
  }
  return out;
}

/** Revenue keys that are totals or derived caps, not sources. */
const REVENUE_NON_SOURCE_KEYS = new Set(["total", "taxLikeRevenue", "taxLikeRevenueAfterCap"]);

export function buildCountryTurnRow(input: CountryTurnInput): CountryTurnRow {
  const missing: string[] = [];
  const read = (path: string, value: unknown): number | null => {
    const n = finiteOrNull(value);
    if (n === null) missing.push(path);
    return n;
  };

  const macro: CountryTurnMacro = {
    inflationRate: read("macro.inflationRate", input.macro.inflationRate),
    targetInflation: read("macro.targetInflation", input.macro.targetInflation),
    primeRate: read("macro.primeRate", input.macro.primeRate),
    effectiveRate: read("macro.effectiveRate", input.macro.effectiveRate),
    gdpGrowth: read("macro.gdpGrowth", input.macro.gdpGrowth),
    outputGap: read("macro.outputGap", input.macro.outputGap),
    unemploymentRate: read("macro.unemploymentRate", input.macro.unemploymentRate),
    wageGrowth: read("macro.wageGrowth", input.macro.wageGrowth),
    tradeGrowth: read("macro.tradeGrowth", input.macro.tradeGrowth),
    gdp: read("macro.gdp", input.macro.gdp),
  };

  const m = input.monetary;
  let monetary: CountryTurnMonetary;
  if (m.hasBank) {
    const { decision, delta } = classifyRateDecision(m.changeThisTurn ?? null);
    monetary = {
      authority: classifyPolicyAuthority({
        governmentControlled: m.governmentControlled === true,
        hasCommittee: m.hasCommittee === true,
        chairIsPlayer: m.chairIsPlayer === true,
      }),
      decision,
      rateChange: delta,
      rateChangeActor: m.changeThisTurn ? (m.changeThisTurn.bySystem ? "system" : "player") : null,
      lastRateChangeTurn: finiteOrNull(m.lastRateChangeTurn),
      operationDecision: m.operationDecision ?? null,
      fxRegime: m.fxRegime ?? null,
      monetaryRegime: m.monetaryRegime ?? null,
      capitalControls: m.capitalControls ?? null,
      exchangeRate: read("monetary.exchangeRate", m.exchangeRate),
    };
  } else {
    missing.push("monetary.authority", "monetary.decision");
    monetary = {
      authority: null,
      decision: null,
      rateChange: null,
      rateChangeActor: null,
      lastRateChangeTurn: null,
      operationDecision: null,
      fxRegime: m.fxRegime ?? null,
      monetaryRegime: m.monetaryRegime ?? null,
      capitalControls: m.capitalControls ?? null,
      exchangeRate: read("monetary.exchangeRate", m.exchangeRate),
    };
  }

  const f = input.fiscal;
  const fiscalRead = (path: string, value: unknown) =>
    f.hasBudget ? read(`fiscal.${path}`, value) : null;
  if (!f.hasBudget) missing.push("fiscal");
  const surplus = fiscalRead("surplus", f.surplus);
  const debtInterest = fiscalRead("debtInterest", f.spending?.debtInterest);
  const debtPrincipal = fiscalRead("debtPrincipal", f.debtPrincipal);
  const denominator = debtRatioDenominator(macro.gdp, finiteOrNull(f.gdpSmoothed));
  const fiscal: CountryTurnFiscal = {
    fiscalYear: fiscalRead("fiscalYear", f.fiscalYear),
    revenueTotal: fiscalRead("revenueTotal", f.revenue?.total),
    revenueBySource: numericRecord(f.revenue, REVENUE_NON_SOURCE_KEYS),
    spendingTotal: fiscalRead("spendingTotal", f.spending?.total),
    spendingByCategory: numericRecord(f.spending?.byCategory, new Set()),
    stateGrants: fiscalRead("stateGrants", f.spending?.stateGrants),
    debtInterest,
    primaryBalance: surplus !== null && debtInterest !== null ? surplus + debtInterest : null,
    surplus,
    treasuryBalance: fiscalRead("treasuryBalance", f.treasuryBalance),
    debtPrincipal,
    debtInterestRate: fiscalRead("debtInterestRate", f.debtInterestRate),
    debtToGdpRatio: fiscalRead("debtToGdpRatio", f.debtToGdpRatio),
    debtToGdpDenominator: denominator?.source ?? null,
    debtToGdpDenominatorValue: denominator?.value ?? null,
    creditRating: f.creditRating ?? null,
    sovereignIssuedFace: f.issuedFace,
    sovereignRetiredFace: f.retiredFace,
    sovereignDefaultedFace: f.defaultedFace,
    sovereignScheduledCoupon: f.scheduledCoupon,
  };
  if (f.hasBudget && !denominator) missing.push("fiscal.debtToGdpDenominator");

  return {
    ...stampProvenance(input, COUNTRY_TURN_CALC_VERSION),
    country: input.country,
    currencyCode: input.currencyCode ?? null,
    macro,
    monetary,
    fiscal,
    events: { atWar: input.conflictIds.length > 0, conflictIds: [...input.conflictIds].sort() },
    missing,
  };
}

/** GDP-weighted mean of a regional series; null when no region reports both values. */
export function weightedMean(rows: ReadonlyArray<{ value: unknown; weight: unknown }>) {
  let sum = 0;
  let weight = 0;
  for (const row of rows) {
    const v = finiteOrNull(row.value);
    const w = finiteOrNull(row.weight);
    if (v === null || w === null || w <= 0) continue;
    sum += v * w;
    weight += w;
  }
  return weight > 0 ? sum / weight : null;
}

export interface SovereignBondFlowInput {
  countryId?: string | null;
  matured?: boolean;
  defaulted?: boolean;
  totalIssued?: number;
  couponRate?: number;
  issuedAtTurn?: number;
  redeemedAtTurn?: number;
  defaultedAtTurn?: number | null;
}

export interface SovereignFlows {
  issuedFace: number;
  retiredFace: number;
  defaultedFace: number;
  scheduledCoupon: number;
}

/**
 * Sovereign face flows recorded on `turn` for one country, read off the bond
 * ledger. Issuance and redemption are matched on the stamped turn, so a turn
 * that is replayed or retried records the same flows. The coupon is the
 * scheduled per-turn payment on face still outstanding and not defaulted
 * (annual rate over `turnsPerYear`), before any settlement shortfall.
 */
export function sovereignFlowsForTurn(
  bonds: readonly SovereignBondFlowInput[],
  country: string,
  turn: number,
  turnsPerYear: number
): SovereignFlows {
  let issued = 0;
  let retired = 0;
  let defaulted = 0;
  let coupon = 0;
  for (const bond of bonds) {
    if (bond.countryId !== country) continue;
    const face = finiteOrNull(bond.totalIssued) ?? 0;
    if (bond.issuedAtTurn === turn) issued += face;
    if (bond.redeemedAtTurn === turn) retired += face;
    if (bond.defaultedAtTurn === turn && bond.defaulted === true) defaulted += face;
    if (!bond.matured && !bond.defaulted && turnsPerYear > 0) {
      coupon += (((finiteOrNull(bond.couponRate) ?? 0) / 100) * face) / turnsPerYear;
    }
  }
  return {
    issuedFace: round(issued, 2),
    retiredFace: round(retired, 2),
    defaultedFace: round(defaulted, 2),
    scheduledCoupon: round(coupon, 2),
  };
}

// ── Annual fiscal and debt decomposition (#2336) ─────────────────────────────

export interface AnnualFiscalRow {
  country: string;
  fiscalYear: number;
  firstTurn: number;
  lastTurn: number;
  firstObservedAt: Date;
  lastObservedAt: Date;
  retainedTurns: number;
  /** Expected turns between first and last retained turn that have no row. */
  missingTurns: number[];
  currencyCode: string | null;
  /** Closing principal of the prior retained turn, or derived for the first year. */
  openingDebt: number | null;
  openingDebtSource: "prior-turn-close" | "derived-from-first-turn-flows" | null;
  closingDebt: number | null;
  issued: number;
  retired: number;
  defaulted: number;
  scheduledCoupons: number;
  /**
   * closing - (opening + issued - retired - defaulted). Restructure haircuts
   * and merger/secession transfers are not stamped per turn by the bond
   * ledger, so they surface here instead of being hidden.
   */
  reconciliationResidual: number | null;
  /** Budget-basis annual figures at the fiscal-year close (last retained turn). */
  revenueTotal: number | null;
  revenueBySource: Record<string, number>;
  spendingTotal: number | null;
  spendingByCategory: Record<string, number>;
  debtInterest: number | null;
  surplus: number | null;
  primaryBalance: number | null;
  openingTreasury: number | null;
  closingTreasury: number | null;
  treasuryChange: number | null;
  gdp: number | null;
  debtToGdpRatio: number | null;
  debtToGdpDenominator: DebtRatioDenominator | null;
  debtToGdpDenominatorValue: number | null;
  /** closingDebt / denominator: reproduces the reported ratio from exported fields. */
  debtToGdpReproduced: number | null;
  /** Nominal GDP growth over the prior fiscal year's closing GDP. */
  nominalGdpGrowth: number | null;
  /** debtInterest / mean(opening, closing) debt. */
  effectiveInterestRate: number | null;
  /** effectiveInterestRate - nominalGdpGrowth (r - g). */
  interestGrowthDifferential: number | null;
  warTurns: number;
  conflictIds: string[];
  creditRating: string | null;
  calcVersion: number;
}

/**
 * Collapse country-turn rows into one row per country and fiscal year. Rows
 * may arrive in any order; each country is processed oldest turn first. The
 * flow totals are exact sums over retained turns; a gap in retained turns is
 * listed in `missingTurns`, and the residual then also absorbs the flows of
 * the missing turns rather than pretending they were zero.
 */
export function buildAnnualFiscalPanel(rows: readonly CountryTurnRow[]): AnnualFiscalRow[] {
  const byCountry = new Map<string, CountryTurnRow[]>();
  for (const row of rows) {
    if (row.fiscal.fiscalYear === null) continue;
    const list = byCountry.get(row.country) ?? [];
    list.push(row);
    byCountry.set(row.country, list);
  }

  const out: AnnualFiscalRow[] = [];
  for (const [country, list] of [...byCountry].sort(([a], [b]) => a.localeCompare(b))) {
    list.sort((a, b) => a.turn - b.turn);
    const years: CountryTurnRow[][] = [];
    for (const row of list) {
      const current = years[years.length - 1];
      if (current && current[0].fiscal.fiscalYear === row.fiscal.fiscalYear) current.push(row);
      else years.push([row]);
    }

    let priorClose: CountryTurnRow | null = null;
    let priorAnnual: AnnualFiscalRow | null = null;
    for (const turns of years) {
      const first = turns[0];
      const last = turns[turns.length - 1];
      const sum = (pick: (r: CountryTurnRow) => number) => turns.reduce((t, r) => t + pick(r), 0);
      const issued = sum((r) => r.fiscal.sovereignIssuedFace);
      const retired = sum((r) => r.fiscal.sovereignRetiredFace);
      const defaulted = sum((r) => r.fiscal.sovereignDefaultedFace);

      let openingDebt: number | null = null;
      let openingDebtSource: AnnualFiscalRow["openingDebtSource"] = null;
      if (priorClose && priorClose.fiscal.debtPrincipal !== null) {
        openingDebt = priorClose.fiscal.debtPrincipal;
        openingDebtSource = "prior-turn-close";
      } else if (first.fiscal.debtPrincipal !== null) {
        openingDebt =
          first.fiscal.debtPrincipal -
          first.fiscal.sovereignIssuedFace +
          first.fiscal.sovereignRetiredFace +
          first.fiscal.sovereignDefaultedFace;
        openingDebtSource = "derived-from-first-turn-flows";
      }
      const closingDebt = last.fiscal.debtPrincipal;
      const residual =
        openingDebt !== null && closingDebt !== null
          ? round(closingDebt - (openingDebt + issued - retired - defaulted), 2)
          : null;

      const missingTurns: number[] = [];
      const present = new Set(turns.map((r) => r.turn));
      const startTurn = priorClose ? priorClose.turn + 1 : first.turn;
      for (let t = startTurn; t <= last.turn; t++) if (!present.has(t)) missingTurns.push(t);

      const gdp = last.macro.gdp;
      const nominalGdpGrowth =
        priorAnnual?.gdp && gdp !== null
          ? ratioOrNull(gdp - priorAnnual.gdp, priorAnnual.gdp)
          : null;
      const meanDebt =
        openingDebt !== null && closingDebt !== null ? (openingDebt + closingDebt) / 2 : null;
      const effectiveInterestRate =
        last.fiscal.debtInterest !== null && meanDebt !== null
          ? ratioOrNull(last.fiscal.debtInterest, meanDebt)
          : null;
      const conflictIds = [...new Set(turns.flatMap((r) => r.events.conflictIds))].sort();
      const openingTreasury = priorClose?.fiscal.treasuryBalance ?? first.fiscal.treasuryBalance;
      const closingTreasury = last.fiscal.treasuryBalance;

      const annual: AnnualFiscalRow = {
        country,
        fiscalYear: first.fiscal.fiscalYear as number,
        firstTurn: first.turn,
        lastTurn: last.turn,
        firstObservedAt: first.observedAt,
        lastObservedAt: last.observedAt,
        retainedTurns: turns.length,
        missingTurns,
        currencyCode: last.currencyCode,
        openingDebt,
        openingDebtSource,
        closingDebt,
        issued: round(issued, 2),
        retired: round(retired, 2),
        defaulted: round(defaulted, 2),
        scheduledCoupons: round(
          sum((r) => r.fiscal.sovereignScheduledCoupon),
          2
        ),
        reconciliationResidual: residual,
        revenueTotal: last.fiscal.revenueTotal,
        revenueBySource: last.fiscal.revenueBySource,
        spendingTotal: last.fiscal.spendingTotal,
        spendingByCategory: last.fiscal.spendingByCategory,
        debtInterest: last.fiscal.debtInterest,
        surplus: last.fiscal.surplus,
        primaryBalance: last.fiscal.primaryBalance,
        openingTreasury,
        closingTreasury,
        treasuryChange:
          openingTreasury !== null && closingTreasury !== null
            ? closingTreasury - openingTreasury
            : null,
        gdp,
        debtToGdpRatio: last.fiscal.debtToGdpRatio,
        debtToGdpDenominator: last.fiscal.debtToGdpDenominator,
        debtToGdpDenominatorValue: last.fiscal.debtToGdpDenominatorValue,
        debtToGdpReproduced:
          closingDebt !== null && last.fiscal.debtToGdpDenominatorValue !== null
            ? ratioOrNull(closingDebt, last.fiscal.debtToGdpDenominatorValue)
            : null,
        nominalGdpGrowth,
        effectiveInterestRate,
        interestGrowthDifferential:
          effectiveInterestRate !== null && nominalGdpGrowth !== null
            ? effectiveInterestRate - nominalGdpGrowth
            : null,
        warTurns: turns.filter((r) => r.events.atWar).length,
        conflictIds,
        creditRating: last.fiscal.creditRating,
        calcVersion: ANNUAL_FISCAL_CALC_VERSION,
      };
      out.push(annual);
      priorClose = last;
      priorAnnual = annual;
    }
  }
  return out;
}

// ── Bilateral trade panel (#2333) ────────────────────────────────────────────

export interface TradePairObservation {
  exporter: string;
  importer: string;
  deliveredUnits: number;
  dispatchedUnits: number;
  askValue: number;
  freightPaid: number;
  tariffPaid: number;
  landedValue: number;
  tariffRateUnits: number;
  legs: number;
}

export interface TradeDestinationObservation {
  country: string;
  demandUnits: number;
  supplyUnits: number;
  foreignOfferUnits: number;
  localUnits: number;
  interStateUnits: number;
  importUnits: number;
  unmetUnits: number;
  toleranceBoundUnits: number;
  capacityBoundUnits: number;
}

/** Commodity summary as recorded by the sourcing ledger (observer basis). */
export interface TradeCommoditySummary {
  demandUnitsIntent: number;
  intraStateUnits: number;
  interStateUnits: number;
  importUnits: number;
  unmetUnits: number;
  toleranceBoundUnits: number;
  capacityBoundUnits: number;
}

/** One durable row per (world, commodity, turn). */
export interface TradeTelemetryRow extends ResearchProvenance {
  commodity: string;
  /** Price units of the sourcing pass (the stored commodity asks). */
  priceUnits: "commodity-ask";
  summary: TradeCommoditySummary;
  pairs: TradePairObservation[];
  destinations: TradeDestinationObservation[];
}

export interface TradeTelemetryInput extends ResearchProvenanceInput {
  commodity: string;
  summary: TradeCommoditySummary;
  pairs: TradePairObservation[];
  destinations: TradeDestinationObservation[];
}

export function buildTradeTelemetryRow(input: TradeTelemetryInput): TradeTelemetryRow {
  return {
    ...stampProvenance(input, TRADE_PANEL_CALC_VERSION),
    commodity: input.commodity,
    priceUnits: "commodity-ask",
    summary: input.summary,
    pairs: [...input.pairs].sort(
      (a, b) => a.exporter.localeCompare(b.exporter) || a.importer.localeCompare(b.importer)
    ),
    destinations: [...input.destinations].sort((a, b) => a.country.localeCompare(b.country)),
  };
}

/** Context of a directed pair at the time of observation. */
export interface TradePairPolicy {
  tariffRatePct: number | null;
  freeTradeAgreement: boolean | null;
  embargoed: boolean | null;
}

export interface TradePanelRow {
  worldId: string;
  runId?: string;
  seed?: string;
  codeVersion?: string;
  commodity: string;
  turn: number;
  year: number;
  observedAt: Date;
  exporter: string;
  importer: string;
  /** False for an explicit zero-flow pair: both countries were observed, nothing moved. */
  traded: boolean;
  deliveredUnits: number;
  dispatchedUnits: number;
  /** Ask value / dispatched units; null on zero flow (no price is observed). */
  unitAsk: number | null;
  /** Landed value / delivered units; null on zero flow. */
  unitLanded: number | null;
  freightPaid: number;
  tariffPaid: number;
  /** Unit-weighted applied tariff; on zero flow the scheduled rate when known. */
  tariffRatePct: number | null;
  freeTradeAgreement: boolean | null;
  embargoed: boolean | null;
}

/**
 * Expand recorded pairs to the full directed cross product of observed
 * countries (zero-flow pairs explicit, never silently absent). Domestic
 * interstate haulage (exporter === importer) is kept as its own row.
 */
export function expandTradePanel(
  row: TradeTelemetryRow,
  policyFor?: (exporter: string, importer: string) => TradePairPolicy | null
): TradePanelRow[] {
  const countries = new Set<string>();
  for (const d of row.destinations) countries.add(d.country);
  for (const p of row.pairs) {
    countries.add(p.exporter);
    countries.add(p.importer);
  }
  const sorted = [...countries].sort();
  const byKey = new Map(row.pairs.map((p) => [`${p.exporter}\u0000${p.importer}`, p]));
  const out: TradePanelRow[] = [];
  for (const exporter of sorted) {
    for (const importer of sorted) {
      const pair = byKey.get(`${exporter}\u0000${importer}`);
      if (exporter === importer && !pair) continue;
      const policy = policyFor?.(exporter, importer) ?? null;
      out.push({
        worldId: row.worldId,
        ...(row.runId !== undefined ? { runId: row.runId } : {}),
        ...(row.seed !== undefined ? { seed: row.seed } : {}),
        ...(row.codeVersion !== undefined ? { codeVersion: row.codeVersion } : {}),
        commodity: row.commodity,
        turn: row.turn,
        year: row.year,
        observedAt: row.observedAt,
        exporter,
        importer,
        traded: !!pair && pair.deliveredUnits > 0,
        deliveredUnits: pair?.deliveredUnits ?? 0,
        dispatchedUnits: pair?.dispatchedUnits ?? 0,
        unitAsk: pair ? ratioOrNull(pair.askValue, pair.dispatchedUnits) : null,
        unitLanded: pair ? ratioOrNull(pair.landedValue, pair.deliveredUnits) : null,
        freightPaid: pair?.freightPaid ?? 0,
        tariffPaid: pair?.tariffPaid ?? 0,
        tariffRatePct: pair
          ? ratioOrNull(pair.tariffRateUnits, pair.deliveredUnits)
          : (policy?.tariffRatePct ?? null),
        freeTradeAgreement: policy?.freeTradeAgreement ?? null,
        embargoed: policy?.embargoed ?? null,
      });
    }
  }
  return out;
}

export interface TradeObserverMetrics {
  intentFulfillmentRate: number | null;
  localShare: number | null;
  interstateShare: number | null;
  importShare: number | null;
  /** Share of fulfilled intent served from outside the buyer's own state. */
  nonlocalShare: number | null;
  toleranceBoundShareOfUnmet: number | null;
  capacityBoundShareOfUnmet: number | null;
}

/**
 * Reproduce the market observer's trade decomposition (economic vital signs)
 * from exported destination rows, so researchers can check the panel against
 * the published metric. Same numerators and denominators as the observer.
 */
export function tradeObserverMetrics(
  rows: ReadonlyArray<Pick<TradeTelemetryRow, "destinations">>
): TradeObserverMetrics {
  let demand = 0;
  let local = 0;
  let interstate = 0;
  let imported = 0;
  let unmet = 0;
  let tolerance = 0;
  let capacity = 0;
  for (const row of rows) {
    for (const d of row.destinations) {
      demand += d.demandUnits;
      local += d.localUnits;
      interstate += d.interStateUnits;
      imported += d.importUnits;
      unmet += d.unmetUnits;
      tolerance += d.toleranceBoundUnits;
      capacity += d.capacityBoundUnits;
    }
  }
  const fulfilled = local + interstate + imported;
  return {
    intentFulfillmentRate: ratioOrNull(fulfilled, demand),
    localShare: ratioOrNull(local, fulfilled),
    interstateShare: ratioOrNull(interstate, fulfilled),
    importShare: ratioOrNull(imported, fulfilled),
    nonlocalShare: ratioOrNull(interstate + imported, fulfilled),
    toleranceBoundShareOfUnmet: ratioOrNull(tolerance, unmet),
    capacityBoundShareOfUnmet: ratioOrNull(capacity, unmet),
  };
}

// ── Securities panel (#2332) ─────────────────────────────────────────────────

/** How the recorded price was produced. */
export type PriceBasis = "executed" | "model" | "administrative";

export interface SecurityExecutions {
  count: number;
  units: number;
  valueAnchor: number;
  /** Value-weighted price per unit in anchor currency; null with no trade. */
  vwapAnchor: number | null;
}

export interface SecurityBook {
  bidUnits: number;
  askUnits: number;
  bestBid: number | null;
  bestAsk: number | null;
  twoSided: boolean;
  /** (ask - bid) / mid x 100 when two-sided and uncrossed. */
  spreadPct: number | null;
  /** Standing quotes come from the bounded liquidity facility. */
  facilityQuoted: boolean;
  organicTwoSided: boolean;
}

export interface SecurityTurnRow {
  securityId: string;
  assetClass: "equity" | "bond";
  issuerType: "corporation" | "sovereign" | "state-enterprise";
  issuerCountry: string | null;
  currencyCode: string | null;
  /** Local units per anchor unit; null when no FX conversion was available. */
  fxRate: number | null;
  fxStatus: "converted" | "missing-fx" | "anchor";
  /** Recorded price in local currency and the basis it came from. */
  price: number | null;
  priceBasis: PriceBasis;
  /** Model/administrative mark, kept even when a trade executed. */
  modelPrice: number | null;
  lastExecutedPriceAnchor: number | null;
  executions: SecurityExecutions;
  book: SecurityBook | null;
  unitsOutstanding: number | null;
  publicFloat: number | null;
  /** Cash distributed per unit this turn (dividend or coupon), local currency. */
  distributionPerUnit: number | null;
  /** Equity: income, revenue, liquid capital (book proxy), local currency. */
  fundamentals: { revenue: number | null; income: number | null; liquidCapital: number | null };
  /** Bond-only fields. */
  bond: {
    couponRate: number;
    maturityTurn: number;
    defaulted: boolean;
    matured: boolean;
    /** Units held by holder class (aggregated, never per holder). */
    unitsByHolderClass: Record<string, number>;
    hasHolders: boolean;
  } | null;
}

export interface MarketPoolRow {
  pool: "equity" | "bond";
  currencyCode: string;
  cashLocal: number | null;
  targetCashLocal: number | null;
}

/** One durable row per (world, turn): every security observed that turn. */
export interface SecurityTelemetryRow extends ResearchProvenance {
  securities: SecurityTurnRow[];
  pools: MarketPoolRow[];
}

export function buildSecurityTelemetryRow(
  input: ResearchProvenanceInput & { securities: SecurityTurnRow[]; pools: MarketPoolRow[] }
): SecurityTelemetryRow {
  return {
    ...stampProvenance(input, SECURITY_PANEL_CALC_VERSION),
    securities: [...input.securities].sort(
      (a, b) => a.assetClass.localeCompare(b.assetClass) || a.securityId.localeCompare(b.securityId)
    ),
    pools: [...input.pools].sort(
      (a, b) => a.pool.localeCompare(b.pool) || a.currencyCode.localeCompare(b.currencyCode)
    ),
  };
}

export interface BookOrder {
  type: "buy" | "sell";
  pricePerShare: number;
  sharesRemaining: number;
  liquidityProvider?: boolean;
}

/** Book summary with the observer's spread definition (economic vital signs). */
export function summarizeBook(orders: readonly BookOrder[]): SecurityBook {
  const buys = orders.filter((o) => o.type === "buy" && o.sharesRemaining > 0);
  const sells = orders.filter((o) => o.type === "sell" && o.sharesRemaining > 0);
  const bestBid = buys.length > 0 ? Math.max(...buys.map((o) => o.pricePerShare)) : null;
  const bestAsk = sells.length > 0 ? Math.min(...sells.map((o) => o.pricePerShare)) : null;
  const twoSided = bestBid !== null && bestAsk !== null;
  let spreadPct: number | null = null;
  if (twoSided) {
    const mid = (bestBid + bestAsk) / 2;
    if (bestAsk >= bestBid && mid > 0) spreadPct = ((bestAsk - bestBid) / mid) * 100;
  }
  return {
    bidUnits: buys.reduce((t, o) => t + o.sharesRemaining, 0),
    askUnits: sells.reduce((t, o) => t + o.sharesRemaining, 0),
    bestBid,
    bestAsk,
    twoSided,
    spreadPct,
    facilityQuoted: orders.some((o) => o.liquidityProvider === true),
    organicTwoSided:
      buys.some((o) => o.liquidityProvider !== true) &&
      sells.some((o) => o.liquidityProvider !== true),
  };
}

export function summarizeExecutions(
  trades: ReadonlyArray<{ shares: number; totalAnchor: number }>
): SecurityExecutions {
  let units = 0;
  let value = 0;
  for (const t of trades) {
    const s = finiteOrNull(t.shares);
    const v = finiteOrNull(t.totalAnchor);
    if (s === null || v === null || s <= 0 || v < 0) continue;
    units += s;
    value += v;
  }
  return {
    count: trades.length,
    units,
    valueAnchor: round(value, 4),
    vwapAnchor: units > 0 ? value / units : null,
  };
}

export interface SecuritiesMarketMetrics {
  equitiesObserved: number;
  /** Equities with at least one executed trade in the window. */
  tradedShare: number | null;
  zeroTradeShare: number | null;
  /** Share of equity-turns with a two-sided book. */
  twoSidedShare: number | null;
  /** Spread weighted by quoted depth value (local x fx to anchor). */
  valueWeightedSpreadPct: number | null;
  bondsObserved: number;
  /** Share of outstanding, non-defaulted bonds with at least one holder. */
  bondHolderCoverage: number | null;
}

/**
 * Reproduce the market-completion measures from exported security rows over
 * any window: fraction of listings traded, zero-trade share, two-sided book
 * share, value-weighted spread and bond-holder coverage (last observation).
 */
export function securitiesMarketMetrics(
  rows: readonly SecurityTelemetryRow[]
): SecuritiesMarketMetrics {
  const traded = new Set<string>();
  const equities = new Set<string>();
  let equityTurns = 0;
  let twoSidedTurns = 0;
  let spreadWeight = 0;
  let spreadSum = 0;
  const lastBond = new Map<string, SecurityTurnRow>();
  for (const row of [...rows].sort((a, b) => a.turn - b.turn)) {
    for (const s of row.securities) {
      if (s.assetClass === "bond") {
        lastBond.set(s.securityId, s);
        continue;
      }
      equities.add(s.securityId);
      equityTurns += 1;
      if (s.executions.count > 0) traded.add(s.securityId);
      if (s.book?.twoSided) {
        twoSidedTurns += 1;
        if (s.book.spreadPct !== null && s.book.bestBid !== null && s.book.bestAsk !== null) {
          const toAnchor =
            s.fxRate && s.fxRate > 0 ? 1 / s.fxRate : s.fxStatus === "anchor" ? 1 : 0;
          const depth =
            (s.book.bidUnits * s.book.bestBid + s.book.askUnits * s.book.bestAsk) * toAnchor;
          if (depth > 0) {
            spreadSum += s.book.spreadPct * depth;
            spreadWeight += depth;
          }
        }
      }
    }
  }
  const liveBonds = [...lastBond.values()].filter(
    (b) => b.bond && !b.bond.matured && !b.bond.defaulted
  );
  return {
    equitiesObserved: equities.size,
    tradedShare: ratioOrNull(traded.size, equities.size),
    zeroTradeShare: ratioOrNull(equities.size - traded.size, equities.size),
    twoSidedShare: ratioOrNull(twoSidedTurns, equityTurns),
    valueWeightedSpreadPct: spreadWeight > 0 ? spreadSum / spreadWeight : null,
    bondsObserved: lastBond.size,
    bondHolderCoverage: ratioOrNull(
      liveBonds.filter((b) => b.bond?.hasHolders).length,
      liveBonds.length
    ),
  };
}

export interface BondHolderInput {
  units?: number;
  characterId?: unknown;
  imperialCharacterId?: unknown;
  corporationId?: unknown;
  fundId?: unknown;
  nppId?: unknown;
  bankId?: unknown;
}

/**
 * Aggregate bond units by holder class. Identities never leave this function:
 * the export carries class totals only. The market pool float and central bank
 * QE holdings are their own classes so coverage can be recomputed with or
 * without them.
 */
export function bondUnitsByHolderClass(
  holders: readonly BondHolderInput[],
  publicFloat?: number,
  centralBankHoldings?: number
): Record<string, number> {
  const out: Record<string, number> = {};
  const add = (cls: string, units: unknown) => {
    const n = finiteOrNull(units);
    if (n === null || n <= 0) return;
    out[cls] = (out[cls] ?? 0) + n;
  };
  for (const h of holders) {
    const cls = h.fundId
      ? "fund"
      : h.nppId
        ? "npp"
        : h.bankId
          ? "bank"
          : h.corporationId
            ? "corporation"
            : h.characterId || h.imperialCharacterId
              ? "player"
              : "other";
    add(cls, h.units);
  }
  add("market_pool", publicFloat);
  add("central_bank", centralBankHoldings);
  return out;
}

export interface TotalReturnPoint {
  turn: number;
  price: number | null;
  distribution: number;
  /** (P_t + D_t) / P_{t-1} - 1; null when either price is missing or a turn is skipped. */
  totalReturn: number | null;
}

/**
 * Per-turn total return for one security including distributions, from the
 * recorded price (whatever its basis) and cash distributed per unit. A
 * missing turn breaks the chain rather than spanning it silently.
 */
export function totalReturnSeries(
  points: ReadonlyArray<{ turn: number; price: number | null; distributionPerUnit: number | null }>
): TotalReturnPoint[] {
  const sorted = [...points].sort((a, b) => a.turn - b.turn);
  const out: TotalReturnPoint[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i];
    const prev = i > 0 ? sorted[i - 1] : null;
    const distribution = p.distributionPerUnit ?? 0;
    const contiguous = prev !== null && prev.turn === p.turn - 1;
    const totalReturn =
      contiguous && prev.price !== null && prev.price > 0 && p.price !== null
        ? (p.price + distribution) / prev.price - 1
        : null;
    out.push({ turn: p.turn, price: p.price, distribution, totalReturn });
  }
  return out;
}

// ── Bounded export query ─────────────────────────────────────────────────────

export const RESEARCH_PANELS = ["country-turn", "annual-fiscal", "trade", "securities"] as const;
export type ResearchPanel = (typeof RESEARCH_PANELS)[number];

/** Longest inclusive turn window a single request may span (10 game years). */
export const RESEARCH_MAX_TURN_SPAN = 480;
export const RESEARCH_DEFAULT_LIMIT = 500;
export const RESEARCH_MAX_LIMIT = 2000;
/** Securities rows are whole-market documents, so a page holds few turns. */
export const RESEARCH_SECURITY_MAX_TURNS_PER_PAGE = 12;

export interface ResearchQuery {
  panel: ResearchPanel;
  fromTurn: number;
  toTurn: number;
  countries: string[] | null;
  commodities: string[] | null;
  limit: number;
  /** Exclusive resume point from a previous page: `<turn>` or `<turn>:<key>`. */
  after: { turn: number; key: string } | null;
}

export type ResearchQueryResult = { ok: true; query: ResearchQuery } | { ok: false; error: string };

function parseList(raw: string | null | undefined): string[] | null {
  if (!raw) return null;
  const list = raw
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.length > 0 && v.length <= 64);
  return list.length > 0 ? [...new Set(list)].slice(0, 64) : null;
}

/**
 * Parse and bound an export request. A missing `toTurn` defaults to `latest`
 * and a missing `fromTurn` to the start of the allowed window ending there, so
 * no request can ask for an unbounded history.
 */
export function parseResearchQuery(
  params: Record<string, string | null | undefined>,
  latestTurn: number
): ResearchQueryResult {
  const panel = params.panel as ResearchPanel | undefined;
  if (!panel || !RESEARCH_PANELS.includes(panel)) {
    return { ok: false, error: `panel must be one of ${RESEARCH_PANELS.join(", ")}` };
  }
  const int = (raw: string | null | undefined) =>
    raw === undefined || raw === null || raw === "" ? null : Number(raw);
  const toRaw = int(params.toTurn);
  const fromRaw = int(params.fromTurn);
  const limitRaw = int(params.limit);
  for (const [name, v] of [
    ["toTurn", toRaw],
    ["fromTurn", fromRaw],
    ["limit", limitRaw],
  ] as const) {
    if (v !== null && !(Number.isInteger(v) && v >= 0)) {
      return { ok: false, error: `${name} must be a non-negative integer` };
    }
  }
  const toTurn = toRaw ?? latestTurn;
  const fromTurn = fromRaw ?? Math.max(0, toTurn - RESEARCH_MAX_TURN_SPAN + 1);
  if (fromTurn > toTurn) return { ok: false, error: "fromTurn must not exceed toTurn" };
  if (toTurn - fromTurn + 1 > RESEARCH_MAX_TURN_SPAN) {
    return { ok: false, error: `turn window is capped at ${RESEARCH_MAX_TURN_SPAN} turns` };
  }
  let after: ResearchQuery["after"] = null;
  if (params.after) {
    const [turnPart, ...rest] = params.after.split(":");
    const turn = Number(turnPart);
    if (!Number.isInteger(turn) || turn < 0) return { ok: false, error: "after is malformed" };
    after = { turn, key: rest.join(":") };
  }
  return {
    ok: true,
    query: {
      panel,
      fromTurn,
      toTurn,
      countries: parseList(params.countries),
      commodities: parseList(params.commodities),
      limit: Math.min(RESEARCH_MAX_LIMIT, Math.max(1, limitRaw ?? RESEARCH_DEFAULT_LIMIT)),
      after,
    },
  };
}

/** Field units and conventions shipped with every export so rows are self-describing. */
export const RESEARCH_UNITS = {
  rates: "annual percent (not fractions)",
  money: "local currency of the row's currencyCode unless a field name ends in Anchor",
  gdp: "local currency, national level (sum of regions x 1M)",
  turn: "raw game turn; year is the in-game calendar year of that turn",
  observedAt: "actual UTC time the row was written at the end of the turn",
  missing: "null, listed by dotted path in the row's `missing` array; never coerced to zero",
  downsampling: "none: every retained turn is exported, in turn order",
} as const;

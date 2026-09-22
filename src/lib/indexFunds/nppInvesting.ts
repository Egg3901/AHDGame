/**
 * NPP Investing Behavior
 *
 * Non-player characters (NPPs) earn a GDP-proportional budget and invest it
 * into index funds based on their archetype risk preferences.
 *
 * GDP per capita is a rough approximation: each country gets a flat annual
 * income figure divided across 48 turns. Every archetype then allocates 40%
 * of that income to funds (broad vs sector mix and domestic bias vary).
 *
 * Called from the fund cron (Step 6), throttled by NPP_FUND_INVESTMENT_INTERVAL.
 * Gated behind isIndexFundsEnabled (indexFundsMode).
 */

import {
  ObjectId,
  type AnyBulkWriteOperation,
  type Db,
  type Document,
  type UpdateOneModel,
} from "mongodb";
import type { NPP, IndexFund, IndexFundPosition, IndexFundTransaction } from "@/lib/db/types";
import { isIndexFundsEnabled } from "@/lib/indexFunds/featureFlag";
import { emitTxBulk, loadTxThresholds } from "@/lib/financialTxLog/emit";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import {
  FUND_POSITION_COLLECTION,
  FUND_TRANSACTION_COLLECTION,
  listActiveFunds,
} from "@/lib/indexFunds/fundQueries";
import { processNppFundRedemptions, type NppRiskArchetype } from "@/lib/indexFunds/nppRedemption";
import type { CountryId } from "@/lib/constants/countries";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { JP_NPP_INVESTING_MINIMUM } from "@/lib/countries/jp/economy";
import type { GameConfig } from "@/lib/db/types";
import { accountId } from "@/lib/ledger/accounts";
import { emitLedgerEntries } from "@/lib/ledger/emit";
import { isLedgerShadowEnabledFromConfig } from "@/lib/ledger/featureFlag";
import type { LedgerEntryInput } from "@/lib/ledger/types";

// ── GDP per capita by country (USD-equivalent, annual) ────────────────
// These are approximate 2024 GDP per capita figures used to determine NPP
// investable budgets.

const GDP_PER_CAPITA_ANCHOR: Record<string, number> = {
  US: 80000,
  UK: 46000,
  JP: JP_NPP_INVESTING_MINIMUM,
  DE: 51000,
  IE: 103000,
  BR: 9000,
  CN: 12500,
  NG: 2200,
};

const TURNS_PER_YEAR = 48;

// ── NPP wealth saturation damping (#3245) ─────────────────────────────
//
// The per-turn GDP accrual below is the ONLY structural income into NPP
// personal wealth (nppInvestmentCashAnchor + the fund positions it buys), and
// nothing ever consumes it — every other flow is an asset swap (bonds/shares/
// fund units) or an investment return. In autonomous/headless worlds that
// made median NPP wealth a pure ramp (~₳666/turn for US = ₳2,664 per 4-turn
// invest cycle; observed 12.5k → 168k over ~5 game-years, flat Gini because
// every NPP in a country accrues the identical amount).
//
// Fix: damp the accrual linearly as wealth approaches a saturation target,
// instead of adding an expense drain. Rationale: NPP personal wealth sits
// entirely OUTSIDE the shadow-ledger perimeter (accounts.ts defines no NPP
// account kind and this accrual emits no financialTxLog row — it is an
// uninstrumented modeled mint), so booking a drain as a `sink:` leg would
// show up as unexplained money destruction with no matching instrumented
// source. Minting less requires no ledger legs at all and can never debit,
// so live-world NPPs above target simply stop accruing — no crash.
//
// Equilibrium math: income i = GDPpc × investFraction(0.4) / 48 per turn;
// damping d(W) = max(0, 1 − W / cap) with cap = NPP_WEALTH_SATURATION_YEARS ×
// GDPpc. dW/dt = i·(1 − W/cap) ⇒ W(t) = cap·(1 − e^(−t/τ)), τ = cap/i =
// (2 × 48) / 0.4 = 240 turns (5 game-years) in EVERY country. Steady state:
// accrual → 0 at W = cap = 2 years of GDP-per-capita income (US ₳160k,
// UK ₳92k, CN ₳25k, NG ₳4.4k) ≈ 2–3× median annual income (GDPpc runs above
// the median), inside the intended 1–3× band. Above cap only genuine
// investment returns (dividends, coupons, NAV drift) move wealth, and those
// are bounded by portfolio yield rather than compounding unbounded principal.

/**
 * Saturation target for autonomously accrued NPP personal wealth, in years of
 * the home country's GDP-per-capita income. See the block comment above for
 * the full equilibrium derivation.
 */
export const NPP_WEALTH_SATURATION_YEARS = 2;

/** Annual personal income (₳) backing an NPP's accrual, by home country. */
export function nppAnnualIncomeAnchor(countryId: string | undefined): number {
  return GDP_PER_CAPITA_ANCHOR[countryId ?? "US"] ?? GDP_PER_CAPITA_ANCHOR.US;
}

/**
 * Linear income-damping multiplier in [0, 1]: 1 at zero wealth, 0 at/above
 * `annualIncomeAnchor × NPP_WEALTH_SATURATION_YEARS`. Never negative (a
 * saturated NPP earns nothing; it is never charged), and defensively 1 when
 * the income figure is unusable so a bad table entry can't zero out a country.
 */
export function nppAccrualDampingMultiplier(
  wealthAnchor: number,
  annualIncomeAnchor: number
): number {
  if (!Number.isFinite(annualIncomeAnchor) || annualIncomeAnchor <= 0) return 1;
  if (!Number.isFinite(wealthAnchor) || wealthAnchor <= 0) return 1;
  const cap = annualIncomeAnchor * NPP_WEALTH_SATURATION_YEARS;
  return Math.max(0, Math.min(1, 1 - wealthAnchor / cap));
}

/**
 * NPP fund-investing runs every Nth turn rather than every turn — it's the
 * single biggest per-turn write-volume phase (one accrual + several position
 * writes for essentially every non-retired NPP). On the turns it runs, each
 * NPP invests N turns' worth of budget in one chunk (see the budgetMultiplier
 * in processNPPFundInvestments), so total investment over time is unchanged;
 * only the write cadence drops to 1/N. Matches nppActionProcessing's own
 * 4-turn cadence.
 */
export const NPP_FUND_INVESTMENT_INTERVAL = 4;

// ── NPP risk archetypes and fund allocation ──────────────────────────

/**
 * NPP risk archetypes determine what proportion of their investable budget
 * goes to broad vs. sector funds, and whether they lean domestic or global.
 */
export type NPRiskArchetype = "conservative" | "moderate" | "aggressive";

export const ARCHETYPE_ALLOCATIONS: Record<
  NPRiskArchetype,
  { broadPct: number; sectorPct: number; domesticBias: number }
> = {
  conservative: { broadPct: 0.35, sectorPct: 0.05, domesticBias: 0.8 },
  moderate: { broadPct: 0.25, sectorPct: 0.15, domesticBias: 0.5 },
  aggressive: { broadPct: 0.1, sectorPct: 0.3, domesticBias: 0.2 },
};

/**
 * Determine an NPP's risk archetype from their data.
 * Uses political influence and favorability as heuristics.
 */
export function determineNPPRiskArchetype(npp: NPP): NPRiskArchetype {
  const favorability = npp.favorability ?? 50;
  const influence = npp.politicalInfluence ?? 50;
  const score = favorability * 0.6 + influence * 0.4;

  if (score < 35) return "aggressive";
  if (score < 60) return "moderate";
  return "conservative";
}

/**
 * Compute the investable budget (in anchor currency) for an NPP this turn.
 * Each NPP earns their country's GDP per capita / 48 turns, and allocates
 * 40% of that to fund investments (broadPct + sectorPct is 0.40 for every
 * archetype; mix and domestic bias still vary).
 */
export function computeNPPInvestableBudget(
  npp: NPP,
  _anchorCurrency: CurrencyCode = "USD"
): number {
  const perTurnIncome = nppAnnualIncomeAnchor(npp.countryId) / TURNS_PER_YEAR;

  const archetype = determineNPPRiskArchetype(npp);
  const allocation = ARCHETYPE_ALLOCATIONS[archetype];
  const investFraction = allocation.broadPct + allocation.sectorPct;

  // Budget in anchor-currency units (roughly USD-equivalent).
  return Math.floor(perTurnIncome * investFraction);
}

// ── NPP fund subscription ─────────────────────────────────────────────

type ProjectedNPP = {
  _id: ObjectId;
  countryId: CountryId;
  favorability: number;
  politicalInfluence: number;
  funds?: number;
  nppInvestmentCashAnchor?: number;
  lastIndexFundInvestmentTurn?: number;
};

interface PlannedSubscription {
  nppId: ObjectId;
  nppCurrency: CurrencyCode;
  fund: IndexFund;
  units: number;
  costAnchor: number;
  archetype: NPRiskArchetype;
}

interface AppliedNppDebit {
  nppId: ObjectId;
  amount: number;
  balanceAfter: number;
}

function assertBulkWriteCount(label: string, actual: number, expected: number): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected} writes, MongoDB reported ${actual}`);
  }
}

function assertCompensationCount(
  label: string,
  actual: number,
  expected: number,
  requireAll: boolean
): void {
  if ((requireAll && actual !== expected) || actual > expected) {
    throw new Error(`${label}: expected at most ${expected} writes, MongoDB reported ${actual}`);
  }
}

/**
 * Pure (no IO) fund selection for one NPP's budget — split out unchanged from
 * the original per-NPP loop so the batched rewrite below can call it without
 * touching the DB. Same domestic/global/sector allocation + deterministic
 * sector-selection-by-ID-hash logic as before, byte-identical output for the
 * same inputs.
 */
function buildNppSubscriptions(
  npp: ProjectedNPP,
  archetype: NPRiskArchetype,
  budget: number,
  activeFunds: IndexFund[]
): { fund: IndexFund; amount: number }[] {
  const allocation = ARCHETYPE_ALLOCATIONS[archetype];
  const countryId = (npp.countryId ?? "US") as CountryId;

  const domesticFunds = activeFunds.filter(
    (f) => f.scope === "country" && f.countryId === countryId && f.kind === "broad"
  );
  const globalFunds = activeFunds.filter((f) => f.scope === "global" && f.kind === "broad");
  const sectorFunds = activeFunds.filter((f) => f.scope === "global" && f.kind === "sector");

  const totalPct = allocation.broadPct + allocation.sectorPct;
  const domesticBudget = Math.floor(
    (budget * allocation.domesticBias * allocation.broadPct) / totalPct
  );
  const globalBudget = Math.floor(
    (budget * (1 - allocation.domesticBias) * allocation.broadPct) / totalPct
  );
  const sectorBudget = budget - domesticBudget - globalBudget;

  const subscriptions: { fund: IndexFund; amount: number }[] = [];

  if (domesticFunds.length > 0 && domesticBudget > 0) {
    const perFund = Math.floor(domesticBudget / domesticFunds.length);
    for (const fund of domesticFunds) subscriptions.push({ fund, amount: perFund });
  }

  if (globalFunds.length > 0 && globalBudget > 0) {
    const perFund = Math.floor(globalBudget / globalFunds.length);
    for (const fund of globalFunds) subscriptions.push({ fund, amount: perFund });
  }

  if (sectorFunds.length > 0 && sectorBudget > 0) {
    const numSectors = archetype === "aggressive" ? 3 : archetype === "moderate" ? 2 : 1;
    const seed = npp._id
      .toString()
      .split("")
      .reduce((a: number, c: string) => a + c.charCodeAt(0), 0);
    const selectedSectors = [...sectorFunds]
      .sort((a, b) => {
        const aHash = (seed + a.slug.length) % sectorFunds.length;
        const bHash = (seed + b.slug.length) % sectorFunds.length;
        return aHash - bHash;
      })
      .slice(0, numSectors);
    const perSector = Math.floor(sectorBudget / selectedSectors.length);
    for (const fund of selectedSectors) subscriptions.push({ fund, amount: perSector });
  }

  return subscriptions;
}

/**
 * Process fund investments for all active NPPs.
 * Called from the fund cron cycle.
 *
 * Batched rewrite (2026-07): the original version did this per-NPP with an
 * awaited DB round-trip inside the loop (accrual, then per-subscription
 * debit+credit+fund-update+tx-insert) — ~5-10 sequential round-trips per NPP.
 * At 10k+ NPPs that's 50k-100k+ sequential awaits in one turn phase, found via
 * the headless sim harness to be THE dominant cost of a turn (turnLogs showed
 * ~97s of a ~108s turn with zero telemetry, traced to this exact function via
 * the indexFunds phase). Rewritten as: (1) compute every NPP's accrual +
 * subscriptions in memory (pure, no IO — extracted to buildNppSubscriptions),
 * (2) one bulkWrite for all accruals, (3) one bulkWrite for all debits (same
 * $gte guard as before, preserved per-op), (4) fund-level unitSupply/
 * cashAnchor updates AGGREGATED per fund across every NPP first, so a fund
 * held by thousands of NPPs gets ONE $inc, not thousands, (5) position
 * credits split into a bulkWrite for existing positions (using the exact same
 * weighted-avgNavAnchor aggregation-pipeline update creditFundPosition uses)
 * and an insertMany for brand-new positions, (6) one insertMany for the
 * transaction log.
 *
 * Correctness: subscription amounts are constructed as fractions of `budget`
 * that sum to at most `budget` by construction (domesticBudget + globalBudget
 * + sectorBudget === budget, and each per-fund split further floors down) —
 * so investedThisNPP can never exceed the budget just accrued in this same
 * synchronous pass, and the debit guard (kept, not just assumed) will always
 * match. A `investedThisNPP > budget` check is kept anyway as a canary: if
 * that math is ever wrong, this NPP's subscriptions are dropped and logged as
 * an error rather than risking an over-debit.
 */
export type NPPFundInvestingResult = {
  nppsProcessed: number;
  totalInvested: number;
  errors: string[];
  /** Autonomous NPP redemptions queued this pass (0 unless the flag is on). */
  redemptionsQueued: number;
  /** Units queued for autonomous redemption this pass. */
  unitsRedeemed: number;
};

export async function processNPPFundInvestments(
  db: Db,
  options?: { currentTurn?: number; budgetMultiplier?: number }
): Promise<NPPFundInvestingResult> {
  if (!(await isIndexFundsEnabled())) {
    return {
      nppsProcessed: 0,
      totalInvested: 0,
      errors: [],
      redemptionsQueued: 0,
      unitsRedeemed: 0,
    };
  }

  const errors: string[] = [];
  const currentTurn = options?.currentTurn ?? 0;
  // When the caller throttles this pass to run every Nth turn (a performance
  // measure — it's the single biggest per-turn write-volume phase), it passes
  // budgetMultiplier=N so each NPP invests N turns' worth of accrued budget in
  // one chunk. Net investment over time is unchanged; only the write cadence
  // drops to 1/N. Defaults to 1 (every-turn behavior).
  const budgetMultiplier = Math.max(1, Math.floor(options?.budgetMultiplier ?? 1));
  if (currentTurn <= 0) {
    return {
      nppsProcessed: 0,
      totalInvested: 0,
      errors: [],
      redemptionsQueued: 0,
      unitsRedeemed: 0,
    };
  }

  const activeFunds = await listActiveFunds(db);
  if (activeFunds.length === 0) {
    return {
      nppsProcessed: 0,
      totalInvested: 0,
      errors: [],
      redemptionsQueued: 0,
      unitsRedeemed: 0,
    };
  }

  // Per-turn counters for the gated autonomous redemption pass (Step 6b).
  let redemptionsQueued = 0;
  let unitsRedeemed = 0;

  const npps = await db
    .collection<NPP>("npps")
    .find({ retiredAt: null })
    .project<ProjectedNPP>({
      _id: 1,
      countryId: 1,
      favorability: 1,
      politicalInfluence: 1,
      funds: 1,
      nppInvestmentCashAnchor: 1,
      lastIndexFundInvestmentTurn: 1,
    })
    .toArray();

  // Archetypes for the gated autonomous redemption pass (Step 6b). Computed
  // once here from the roster already in hand — no extra NPP read.
  const archetypesByNppId = new Map<string, NppRiskArchetype>();
  for (const npp of npps) {
    archetypesByNppId.set(String(npp._id), determineNPPRiskArchetype(npp as NPP));
  }

  // ── Step 6b: gated autonomous NPP redemptions (#2120) ────────────────────
  // Runs after the subscription writes settle so the planner sees this pass's
  // post-subscribe positions and cash. With the flag absent/false the executor
  // returns with zero writes, so the pass is byte-identical to its pre-flag
  // behavior. Called from both the "nothing subscribed" and the normal exit so
  // a passive NPP that already holds units still rebalances.
  const runNppRedemptionPass = async (): Promise<void> => {
    try {
      const result = await processNppFundRedemptions(db, {
        currentTurn,
        activeFunds,
        archetypesByNppId,
      });
      redemptionsQueued += result.redemptionsQueued;
      unitsRedeemed += result.unitsRedeemed;
      if (result.errors.length > 0) errors.push(...result.errors);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`NPP redemptions: ${message}`);
    }
  };

  // ── Wealth valuation for saturation damping (#3245) ──────────────────────
  // One batched pass over NPP fund positions, valued at the active funds'
  // quotedNav, so the damping below can see where the accrual actually ends up
  // (nearly all of each cycle's budget is immediately converted into fund
  // units — cash alone would never bind). holderKind: "npp" keeps player
  // positions entirely out of this mechanism. Bond/share holdings are
  // deliberately excluded from the measure: they are bounded asset swaps out
  // of the same cash account (bond principal returns to cash at maturity and
  // re-enters the measure), and valuing them would cost two more full-
  // collection scans per cycle.
  const navByFundId = new Map(activeFunds.map((f) => [String(f._id), f.quotedNav]));
  const fundValueByNpp = new Map<string, number>();
  if (npps.length > 0) {
    const positionCursor = db
      .collection<IndexFundPosition>(FUND_POSITION_COLLECTION)
      .find({ holderKind: "npp" }, { projection: { nppId: 1, fundId: 1, units: 1 } });
    for await (const pos of positionCursor) {
      if (!pos.nppId) continue;
      const nav = navByFundId.get(String(pos.fundId));
      if (nav === undefined) continue;
      const key = String(pos.nppId);
      fundValueByNpp.set(key, (fundValueByNpp.get(key) ?? 0) + (pos.units ?? 0) * nav);
    }
  }

  // ── Pass 1: pure in-memory planning — no DB calls in this loop. ──────────
  const now = new Date();
  const accrualOps: AnyBulkWriteOperation<Document>[] = [];
  const debitOps: AnyBulkWriteOperation<Document>[] = [];
  const planned: PlannedSubscription[] = [];
  const ledgerEntries: LedgerEntryInput[] = [];
  const plannedDebits: AppliedNppDebit[] = [];
  let nppsProcessed = 0;
  let totalInvested = 0;

  for (const npp of npps) {
    try {
      const archetype = determineNPPRiskArchetype(npp as NPP);
      // Multiply by the throttle interval so a less-frequent pass invests the
      // same total over time (N turns' worth at once). Multiplier is 1 for the
      // every-turn default. Then damp by current personal wealth (investment
      // cash + fund-position value) so accrual tapers to zero at the
      // saturation target instead of ramping forever — see the #3245 block
      // comment on NPP_WEALTH_SATURATION_YEARS. Saturated NPPs are skipped
      // entirely (no accrual, no subscriptions), never debited.
      const wealthAnchor =
        (npp.nppInvestmentCashAnchor ?? 0) + (fundValueByNpp.get(String(npp._id)) ?? 0);
      const damping = nppAccrualDampingMultiplier(
        wealthAnchor,
        nppAnnualIncomeAnchor(npp.countryId)
      );
      const budget = Math.floor(
        computeNPPInvestableBudget(npp as NPP) * budgetMultiplier * damping
      );
      if (budget <= 0) continue;
      if (npp.lastIndexFundInvestmentTurn === currentTurn) continue;

      accrualOps.push({
        updateOne: {
          filter: {
            _id: npp._id,
            $or: [
              { lastIndexFundInvestmentTurn: { $ne: currentTurn } },
              { lastIndexFundInvestmentTurn: { $exists: false } },
            ],
          },
          update: {
            $inc: { nppInvestmentCashAnchor: budget },
            $set: { lastIndexFundInvestmentTurn: currentTurn, updatedAt: now },
          },
        },
      });

      const currency = COUNTRY_CURRENCY_MAP[npp.countryId] ?? "USD";
      const nppAccount = accountId("npp", npp._id.toString(), currency);
      ledgerEntries.push({
        turn: currentTurn,
        createdAt: now,
        txType: "npp_investment_income",
        legs: [
          {
            account: nppAccount,
            amount: budget,
            currencyCode: currency,
            anchorAmount: budget,
            role: "primary",
          },
          {
            account: accountId("mint", "npp_investment_income", currency),
            amount: -budget,
            currencyCode: currency,
            anchorAmount: -budget,
            role: "contra",
          },
        ],
        sourceRef: { collection: "npps", id: npp._id },
        emitSite: "indexFunds/nppInvesting.ts:income_accrual",
      });

      const subscriptions = buildNppSubscriptions(npp, archetype, budget, activeFunds);
      let investedThisNPP = 0;
      const nppPlanned: PlannedSubscription[] = [];

      // #992 tranche 4: the ledger row for each subscription is denominated
      // in the NPP home currency so the subject account matches the snapshot
      // (npp:<id>:<homeCurrency>); the ₳ value is stated outright, never
      // derived from the live FX table.
      const nppCurrency =
        COUNTRY_CURRENCY_MAP[npp.countryId as keyof typeof COUNTRY_CURRENCY_MAP] ?? "USD";
      for (const { fund, amount } of subscriptions) {
        // Skip near-insolvent funds — below 1 unit of anchor currency, NPPs would
        // mint millions of units per turn from negligible cash, exploding unit supply.
        if (amount <= 0 || fund.quotedNav < 1) continue;
        const units = Math.floor(amount / fund.quotedNav);
        if (units <= 0) continue;
        const costAnchor = units * fund.quotedNav;
        nppPlanned.push({ nppId: npp._id, nppCurrency, fund, units, costAnchor, archetype });
        investedThisNPP += costAnchor;
      }

      if (investedThisNPP > budget) {
        // Should be mathematically impossible (subscriptions sum to <= budget
        // by construction) — canary, not a real guard. Drop rather than risk
        // an over-debit if this ever fires.
        errors.push(
          `NPP ${npp._id}: planned investment ${investedThisNPP} exceeds budget ${budget}, skipping subscriptions this turn`
        );
      } else if (investedThisNPP > 0) {
        debitOps.push({
          updateOne: {
            filter: { _id: npp._id, nppInvestmentCashAnchor: { $gte: investedThisNPP } },
            update: {
              $inc: { nppInvestmentCashAnchor: -investedThisNPP },
              $set: { updatedAt: now },
            },
          },
        });
        plannedDebits.push({
          nppId: npp._id,
          amount: investedThisNPP,
          balanceAfter: (npp.nppInvestmentCashAnchor ?? 0) + budget - investedThisNPP,
        });
        planned.push(...nppPlanned);
        totalInvested += investedThisNPP;
        ledgerEntries.push({
          turn: currentTurn,
          createdAt: now,
          txType: "index_fund_subscribe",
          legs: [
            {
              account: nppAccount,
              amount: -investedThisNPP,
              currencyCode: currency,
              anchorAmount: -investedThisNPP,
              role: "primary",
            },
            {
              account: accountId("sink", "fund_subscription", currency),
              amount: investedThisNPP,
              currencyCode: currency,
              anchorAmount: investedThisNPP,
              role: "contra",
            },
          ],
          sourceRef: { collection: "npps", id: npp._id },
          emitSite: "indexFunds/nppInvesting.ts:subscription_debit",
        });
      }

      nppsProcessed++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`NPP ${npp._id}: ${message}`);
    }
  }

  // ── Pass 2: accrue cash for every NPP, then debit for the ones investing. ─
  // Sequential relative to each other (debit's guard depends on accrual
  // having landed), but each pass is a single batched round-trip.
  if (accrualOps.length > 0) {
    await db.collection("npps").bulkWrite(accrualOps, { ordered: false });
  }
  if (debitOps.length > 0) {
    try {
      const result = await db.collection("npps").bulkWrite(debitOps, { ordered: false });
      assertBulkWriteCount("NPP subscription debits", result.modifiedCount, debitOps.length);
    } catch (originalError) {
      try {
        const undoOps: AnyBulkWriteOperation<Document>[] = plannedDebits.map((debit) => ({
          updateOne: {
            filter: { _id: debit.nppId, nppInvestmentCashAnchor: debit.balanceAfter },
            update: { $inc: { nppInvestmentCashAnchor: debit.amount }, $set: { updatedAt: now } },
          },
        }));
        const result = await db.collection("npps").bulkWrite(undoOps, { ordered: false });
        // A zero count is valid when the failed debit batch applied nothing.
        if (result.modifiedCount > undoOps.length) {
          throw new Error(
            `NPP debit compensation: MongoDB reported ${result.modifiedCount} writes for ${undoOps.length} operations`
          );
        }
      } catch (compensationError) {
        const original =
          originalError instanceof Error ? originalError : new Error(String(originalError));
        const compensation =
          compensationError instanceof Error
            ? compensationError
            : new Error(String(compensationError));
        throw new AggregateError(
          [original, compensation],
          `${original.message}; compensation failed: ${compensation.message}`
        );
      }
      throw originalError;
    }
  }
  if (ledgerEntries.length > 0) {
    const config = await db
      .collection<GameConfig>("gameConfig")
      .findOne({ _id: "default" }, { projection: { ledgerShadow: 1 } });
    if (isLedgerShadowEnabledFromConfig(config)) {
      await emitLedgerEntries(db, ledgerEntries);
    }
  }

  if (planned.length === 0) {
    await runNppRedemptionPass();
    return { nppsProcessed, totalInvested: 0, errors, redemptionsQueued, unitsRedeemed };
  }

  // ── Pass 3: fund-level unitSupply/cashAnchor — ONE op per distinct fund, ──
  // aggregated across every NPP that bought into it, not one op per purchase.
  const perFundTotals = new Map<string, { units: number; cashAnchor: number }>();
  for (const p of planned) {
    const key = String(p.fund._id);
    const entry = perFundTotals.get(key) ?? { units: 0, cashAnchor: 0 };
    entry.units += p.units;
    entry.cashAnchor += p.costAnchor;
    perFundTotals.set(key, entry);
  }
  const fundOps: AnyBulkWriteOperation<Document>[] = [...perFundTotals.entries()].map(
    ([fundId, totals]) => ({
      updateOne: {
        filter: { _id: new ObjectId(fundId) },
        update: {
          $inc: { unitSupply: totals.units, cashAnchor: totals.cashAnchor },
          $set: { updatedAt: now },
        },
      },
    })
  );
  const completed: Record<
    "funds" | "positionUpdates" | "positionInserts" | "transactions",
    "none" | "uncertain" | "confirmed"
  > = {
    funds: "none",
    positionUpdates: "none",
    positionInserts: "none",
    transactions: "none",
  };

  // ── Pass 4: position credits. Existing positions get the SAME weighted- ──
  // avgNavAnchor aggregation-pipeline update creditFundPosition uses (just
  // batched); brand-new positions are pre-detected and inserted directly —
  // no per-position round-trip either way.
  const distinctNppIds = [...new Set(planned.map((p) => String(p.nppId)))].map(
    (id) => new ObjectId(id)
  );
  const existingPositions = await db
    .collection<IndexFundPosition>(FUND_POSITION_COLLECTION)
    .find(
      { holderKind: "npp", nppId: { $in: distinctNppIds } },
      { projection: { fundId: 1, nppId: 1, units: 1, avgNavAnchor: 1 } }
    )
    .toArray();
  const existingByKey = new Map(existingPositions.map((p) => [`${p.fundId}:${p.nppId}`, p]));

  const positionUpdateOps: Array<{ updateOne: UpdateOneModel<Document> }> = [];
  const positionInsertDocs: IndexFundPosition[] = [];
  for (const p of planned) {
    const key = `${p.fund._id}:${p.nppId}`;
    const existing = existingByKey.get(key);
    if (existing) {
      const existingUnits = existing.units ?? 0;
      const newUnits = existingUnits + p.units;
      const existingAverage = existing.avgNavAnchor ?? p.fund.quotedNav;
      const avgNavAnchor =
        newUnits > 0
          ? (existingUnits * existingAverage + p.units * p.fund.quotedNav) / newUnits
          : p.fund.quotedNav;
      positionUpdateOps.push({
        updateOne: {
          filter: { fundId: p.fund._id, holderKind: "npp", nppId: p.nppId },
          // NPP subscriptions are the only writer of NPP position units in
          // this single-threaded turn pass. Preloading the prior values lets
          // Mongo apply a simple modifier instead of evaluating an aggregation
          // pipeline for every one of the thousands of existing positions.
          update: {
            $inc: { units: p.units },
            $set: { avgNavAnchor, updatedAt: now },
          },
        },
      });
    } else {
      positionInsertDocs.push({
        _id: new ObjectId(),
        fundId: p.fund._id,
        holderKind: "npp",
        nppId: p.nppId,
        units: p.units,
        avgNavAnchor: p.fund.quotedNav,
        createdAt: now,
        updatedAt: now,
      });
    }
  }
  // ── Pass 5: transaction log — pure inserts, no contention. ────────────────
  const txDocs: IndexFundTransaction[] = planned.map((p) => ({
    _id: new ObjectId(),
    fundId: p.fund._id,
    kind: "subscription",
    holderKind: "npp",
    nppId: p.nppId,
    units: p.units,
    navAnchor: p.fund.quotedNav,
    amountAnchor: p.costAnchor,
    note: `NPP ${p.nppId} subscription (${p.archetype})`,
    createdAt: now,
  }));
  const compensateAndThrow = async (originalError: unknown): Promise<never> => {
    const failures: Error[] = [];
    const attempt = async (label: string, fn: () => Promise<void>): Promise<void> => {
      try {
        await fn();
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        failures.push(new Error(`${label}: ${detail}`));
      }
    };

    if (completed.transactions !== "none") {
      await attempt("remove subscription transactions", async () => {
        const result = await db
          .collection(FUND_TRANSACTION_COLLECTION)
          .deleteMany({ _id: { $in: txDocs.map((doc) => doc._id) } });
        assertCompensationCount(
          "transaction compensation",
          result.deletedCount,
          txDocs.length,
          completed.transactions === "confirmed"
        );
      });
    }
    if (completed.positionInserts !== "none") {
      await attempt("remove inserted NPP positions", async () => {
        const result = await db
          .collection(FUND_POSITION_COLLECTION)
          .deleteMany({ _id: { $in: positionInsertDocs.map((doc) => doc._id) } });
        assertCompensationCount(
          "inserted-position compensation",
          result.deletedCount,
          positionInsertDocs.length,
          completed.positionInserts === "confirmed"
        );
      });
    }
    if (completed.positionUpdates !== "none") {
      await attempt("restore updated NPP positions", async () => {
        const undoOps: AnyBulkWriteOperation<Document>[] = positionUpdateOps.map((op) => {
          const updateOne = op.updateOne;
          const key = `${String(updateOne.filter.fundId)}:${String(updateOne.filter.nppId)}`;
          const prior = existingByKey.get(key)!;
          const creditedUnits = Number((updateOne.update as Document).$inc.units);
          const creditedAverage = Number((updateOne.update as Document).$set.avgNavAnchor);
          return {
            updateOne: {
              filter: {
                ...updateOne.filter,
                units: (prior.units ?? 0) + creditedUnits,
                avgNavAnchor: creditedAverage,
              },
              update: {
                $set: {
                  units: prior.units ?? 0,
                  avgNavAnchor: prior.avgNavAnchor,
                  updatedAt: prior.updatedAt,
                },
              },
            },
          };
        });
        const result = await db
          .collection(FUND_POSITION_COLLECTION)
          .bulkWrite(undoOps, { ordered: false });
        assertCompensationCount(
          "position compensation",
          result.modifiedCount,
          undoOps.length,
          completed.positionUpdates === "confirmed"
        );
      });
    }
    if (completed.funds !== "none") {
      await attempt("restore fund totals", async () => {
        const undoOps: AnyBulkWriteOperation<Document>[] = [...perFundTotals.entries()].map(
          ([fundId, totals]) => {
            const prior = activeFunds.find((fund) => String(fund._id) === fundId);
            return {
              updateOne: {
                filter: {
                  _id: new ObjectId(fundId),
                  unitSupply: (prior?.unitSupply ?? 0) + totals.units,
                  cashAnchor: (prior?.cashAnchor ?? 0) + totals.cashAnchor,
                },
                update: {
                  $inc: { unitSupply: -totals.units, cashAnchor: -totals.cashAnchor },
                  $set: { updatedAt: now },
                },
              },
            };
          }
        );
        const result = await db.collection("indexFunds").bulkWrite(undoOps, { ordered: false });
        assertCompensationCount(
          "fund compensation",
          result.modifiedCount,
          undoOps.length,
          completed.funds === "confirmed"
        );
      });
    }
    await attempt("refund NPP subscription debits", async () => {
      const undoOps: AnyBulkWriteOperation<Document>[] = plannedDebits.map((debit) => ({
        updateOne: {
          filter: { _id: debit.nppId, nppInvestmentCashAnchor: debit.balanceAfter },
          update: { $inc: { nppInvestmentCashAnchor: debit.amount }, $set: { updatedAt: now } },
        },
      }));
      const result = await db.collection("npps").bulkWrite(undoOps, { ordered: false });
      assertBulkWriteCount("NPP debit compensation", result.modifiedCount, undoOps.length);
    });

    const original =
      originalError instanceof Error ? originalError : new Error(String(originalError));
    if (failures.length > 0) {
      throw new AggregateError(
        [original, ...failures],
        `${original.message}; compensation failed: ${failures.map((error) => error.message).join("; ")}`
      );
    }
    throw original;
  };

  try {
    if (fundOps.length > 0) {
      completed.funds = "uncertain";
      const result = await db.collection("indexFunds").bulkWrite(fundOps, { ordered: false });
      assertBulkWriteCount("fund subscription credits", result.modifiedCount, fundOps.length);
      completed.funds = "confirmed";
    }
    if (positionUpdateOps.length > 0) {
      completed.positionUpdates = "uncertain";
      const result = await db
        .collection(FUND_POSITION_COLLECTION)
        .bulkWrite(positionUpdateOps, { ordered: false });
      assertBulkWriteCount("NPP position credits", result.modifiedCount, positionUpdateOps.length);
      completed.positionUpdates = "confirmed";
    }
    if (positionInsertDocs.length > 0) {
      completed.positionInserts = "uncertain";
      const result = await db
        .collection<IndexFundPosition>(FUND_POSITION_COLLECTION)
        .insertMany(positionInsertDocs);
      assertBulkWriteCount(
        "NPP position inserts",
        Object.keys(result.insertedIds).length,
        positionInsertDocs.length
      );
      completed.positionInserts = "confirmed";
    }
    if (txDocs.length > 0) {
      completed.transactions = "uncertain";
      const result = await db
        .collection<IndexFundTransaction>(FUND_TRANSACTION_COLLECTION)
        .insertMany(txDocs);
      assertBulkWriteCount(
        "NPP transaction inserts",
        Object.keys(result.insertedIds).length,
        txDocs.length
      );
      completed.transactions = "confirmed";
    }

    // ── Pass 6 (#992 tranche 4): financialTxLog legs for the same subscriptions.
    // One index_fund_subscribe row per subscription, subject NPP in the NPP home
    // currency with fundId/fundCurrency meta. The shadow ledger mirrors the fund
    // side off that meta when the currencies match (same convention as the
    // player subscribe rows in fundTxLog.ts); a cross-currency pair stays
    // single-sided under the fund_subscription reason, never guessed. Bulk path:
    // every row carries an explicit anchorAmount so no per-row FX read happens.
    if (planned.length > 0) {
      const thresholds = await loadTxThresholds(db);
      await emitTxBulk(
        db,
        planned.map((p) => ({
          type: "index_fund_subscribe" as const,
          turn: currentTurn,
          createdAt: now,
          subjectType: "npp" as const,
          subjectId: p.nppId,
          subjectName: `NPP ${p.nppId.toString()}`,
          // NPP investment cash is anchor-denominated; state the ₳ value
          // outright in both fields so the flow equals the modeled debit exactly.
          amount: -p.costAnchor,
          anchorAmount: -p.costAnchor,
          currencyCode: p.nppCurrency,
          counterpartyType: "system" as const,
          counterpartyName: p.fund.name,
          meta: {
            fundId: p.fund._id.toString(),
            fundCurrency: p.fund.anchorCurrencyCode,
            units: p.units,
            source: "npp-investing",
          },
        })),
        thresholds
      );
    }
  } catch (error) {
    await compensateAndThrow(error);
  }

  await runNppRedemptionPass();

  return { nppsProcessed, totalInvested, errors, redemptionsQueued, unitsRedeemed };
}

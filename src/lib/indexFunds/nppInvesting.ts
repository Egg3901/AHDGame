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

import { ObjectId, type Db } from "mongodb";
import type { NPP, IndexFund, IndexFundPosition } from "@/lib/db/types";
import { isIndexFundsEnabled } from "@/lib/indexFunds/featureFlag";
import { FUND_POSITION_COLLECTION, listActiveFunds } from "@/lib/indexFunds/fundQueries";
import { MoneyFlowKeyConflictError, MoneyFlowTerminalError } from "@/lib/db/nonAtomicMoneyFlow";
import {
  applyNppInvestSpend,
  buildNppInvestFingerprint,
  buildNppInvestKey,
  recoverNppInvestOrphans,
  resumeNppInvestByKey,
  type NppInvestSubscription,
} from "@/lib/indexFunds/nppInvestSpend";
import type { CountryId } from "@/lib/constants/countries";
import type { CurrencyCode } from "@/lib/constants/currencies";

// ── GDP per capita by country (USD-equivalent, annual) ────────────────
// These are approximate 2024 GDP per capita figures used to determine NPP
// investable budgets.

const GDP_PER_CAPITA_ANCHOR: Record<string, number> = {
  US: 80000,
  UK: 46000,
  JP: 34000,
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

interface PlannedNppInvestment {
  npp: ProjectedNPP;
  archetype: NPRiskArchetype;
  budget: number;
  investedThisNPP: number;
  canarySkipped: boolean;
  subscriptions: { fund: IndexFund; units: number; costAnchor: number }[];
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
 * Crash-safe orchestration (issue #1672): the 2026-07 batched rewrite below
 * (per-NPP planning in memory, then one bulkWrite per write kind) left the
 * whole operation unguarded across six sequential bulk writes: a crash
 * between the accrual bulkWrite and the debit bulkWrite double-invested on
 * retry (the retry re-accrued), a crash after the debits stranded NPP cash
 * with no positions, and a fund or position that vanished mid-pass left units
 * minted against a debit that never matched. The pass now plans every NPP
 * exactly as before (same selection, allocation, damping, budget, NAV, and
 * ordering math, all in memory with no IO in the loop) and then executes one
 * NPP at a time through the `applyNppInvestSpend` primitive: the budget,
 * subscriptions, NAVs, and child keys are pinned on that NPP's receipt before
 * its first mutation, so a same-turn retry replays the stored plan instead of
 * re-accruing or repricing from post-debit state. A same-turn re-run of the
 * whole pass first re-drives receipts a crashed pass left `in_progress`
 * (applied steps converge, the rest land) and then plans fresh only for NPPs
 * without this turn's stamp, so a retry never accrues or invests twice.
 *
 * Perf note: per-NPP keyed flows cost more round trips than the old six bulk
 * writes (each NPP does a claim, a plan persist, and one guarded write per
 * step). That is the price of crash safety, accepted the same way for queued
 * redemptions; measure with `AHD_TURN_ROUNDTRIP_PROFILE=1 npx tsx
 * scripts/perf/one-turn.ts` before and after if this phase regresses.
 *
 * Correctness: subscription amounts are constructed as fractions of `budget`
 * that sum to at most `budget` by construction (domesticBudget + globalBudget
 * + sectorBudget === budget, and each per-fund split further floors down) —
 * so investedThisNPP can never exceed the budget just accrued in this same
 * synchronous pass, and the debit guard (kept, not just assumed) will always
 * match. A `investedThisNPP > budget` check is kept anyway as a canary: if
 * that math is ever wrong, this NPP's subscriptions are dropped and logged as
 * an error rather than risking an over-debit (the NPP still accrues, exactly
 * like the old path).
 *
 * Fail-closed deviations from the old strand-prone behavior (all per-NPP,
 * the rest of the pass continues): a debit whose $gte guard no longer matches
 * refunds the accrual instead of leaving the NPP debited with no positions;
 * a fund or position that vanished between plan and apply compensates the
 * NPP's prefix instead of minting units with no backing or no owner row.
 */
export async function processNPPFundInvestments(
  db: Db,
  options?: { currentTurn?: number; budgetMultiplier?: number }
): Promise<{ nppsProcessed: number; totalInvested: number; errors: string[] }> {
  if (!(await isIndexFundsEnabled())) {
    return { nppsProcessed: 0, totalInvested: 0, errors: [] };
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
    return { nppsProcessed: 0, totalInvested: 0, errors: [] };
  }

  // ── Orphan recovery FIRST, before every read below. ─────────────────────
  // A crashed pass leaves `in_progress` receipts; resuming them applies the
  // accrual, which stamps the NPP row. The roster snapshot must see those
  // stamps, otherwise the planning loop would replan a resumed NPP from
  // post-accrual state (a different fingerprint) and hit the stored receipt.
  // A same-turn re-run without this ordering would fail resumed NPPs on a key
  // conflict instead of skipping them.
  const orphans = await recoverNppInvestOrphans(db, currentTurn);
  let nppsProcessed = orphans.resumed;
  let totalInvested = orphans.investedAnchor;

  const activeFunds = await listActiveFunds(db);
  if (activeFunds.length === 0) {
    return { nppsProcessed, totalInvested, errors };
  }

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
  // Selection, allocation, damping, budget, NAV, and ordering math are
  // byte-identical to the old bulk path; only the write plumbing changed
  // (per-NPP keyed flows below instead of six bulk writes).
  const now = new Date();
  const plans: PlannedNppInvestment[] = [];

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

      const subscriptions = buildNppSubscriptions(npp, archetype, budget, activeFunds);
      let investedThisNPP = 0;
      const nppPlanned: { fund: IndexFund; units: number; costAnchor: number }[] = [];

      for (const { fund, amount } of subscriptions) {
        // Skip near-insolvent funds — below 1 unit of anchor currency, NPPs would
        // mint millions of units per turn from negligible cash, exploding unit supply.
        if (amount <= 0 || fund.quotedNav < 1) continue;
        const units = Math.floor(amount / fund.quotedNav);
        if (units <= 0) continue;
        const costAnchor = units * fund.quotedNav;
        nppPlanned.push({ fund, units, costAnchor });
        investedThisNPP += costAnchor;
      }

      if (investedThisNPP > budget) {
        // Should be mathematically impossible (subscriptions sum to <= budget
        // by construction): canary, not a real guard. The NPP still accrues
        // but its subscriptions are dropped rather than risking an over-debit.
        errors.push(
          `NPP ${npp._id}: planned investment ${investedThisNPP} exceeds budget ${budget}, skipping subscriptions this turn`
        );
        plans.push({
          npp,
          archetype,
          budget,
          investedThisNPP: 0,
          canarySkipped: true,
          subscriptions: [],
        });
      } else {
        plans.push({
          npp,
          archetype,
          budget,
          investedThisNPP,
          canarySkipped: false,
          subscriptions: nppPlanned,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`NPP ${npp._id}: ${message}`);
    }
  }

  if (plans.length === 0) {
    return { nppsProcessed, totalInvested, errors };
  }

  // ── Pass 2: pre-detect existing positions in one batched read. ───────────
  // Pinned per subscription on the flow input: a same-key retry replays the
  // stored flag instead of re-reading (a position created by the first attempt
  // must still read as "new" so its deterministic insert converges instead of
  // double-crediting through the update path).
  const distinctNppIds = [...new Set(plans.map((p) => String(p.npp._id)))].map(
    (id) => new ObjectId(id)
  );
  const existingPositions = await db
    .collection<IndexFundPosition>(FUND_POSITION_COLLECTION)
    .find(
      { holderKind: "npp", nppId: { $in: distinctNppIds } },
      { projection: { fundId: 1, nppId: 1 } }
    )
    .toArray();
  const existingKeys = new Set(existingPositions.map((p) => `${p.fundId}:${p.nppId}`));

  // ── Pass 3: one keyed flow per NPP, in roster order. ─────────────────────
  // Each flow pins its budget, subscriptions, NAVs, and child keys on its
  // receipt before its first mutation; a per-NPP failure is recorded and the
  // rest of the pass continues. Sequential awaits keep the write order
  // deterministic; concurrency across NPPs would interleave fund-credit legs
  // with no benefit (every leg is keyed, so order carries no safety meaning).
  for (const plan of plans) {
    const subscriptions: NppInvestSubscription[] = plan.subscriptions.map((s) => ({
      fundId: s.fund._id,
      fundSlug: s.fund.slug,
      quotedNav: s.fund.quotedNav,
      units: s.units,
      costAnchor: s.costAnchor,
      existingPosition: existingKeys.has(`${s.fund._id}:${plan.npp._id}`),
    }));
    const key = buildNppInvestKey(plan.npp._id, currentTurn);
    const fingerprint = buildNppInvestFingerprint({
      nppId: plan.npp._id,
      turn: currentTurn,
      budget: plan.budget,
      investedAnchor: plan.investedThisNPP,
      archetype: plan.archetype,
      canarySkipped: plan.canarySkipped,
      subscriptions,
    });
    try {
      const result = await applyNppInvestSpend(db, {
        nppId: plan.npp._id,
        turn: currentTurn,
        budget: plan.budget,
        investedAnchor: plan.investedThisNPP,
        archetype: plan.archetype,
        subscriptions,
        canarySkipped: plan.canarySkipped,
        fingerprint,
        idempotencyKey: key,
        now,
      });
      nppsProcessed++;
      totalInvested += result.outcome.investedAnchor;
    } catch (err) {
      // A same-key retry can land on a receipt the orphan driver could not
      // resume (changed figures fail the fingerprint check by design, and a
      // settled receipt fails terminal-closed). Reconcile by key: a resumable
      // receipt completes here and tallies; anything else records the original
      // error and the NPP invests next cycle under a new key.
      if (err instanceof MoneyFlowKeyConflictError || err instanceof MoneyFlowTerminalError) {
        try {
          const reconciled = await resumeNppInvestByKey(db, key, plan.npp._id, currentTurn);
          if (reconciled) {
            nppsProcessed++;
            totalInvested += reconciled.outcome.investedAnchor;
            continue;
          }
        } catch {
          // Fall through to the recorded error below.
        }
      }
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`NPP ${plan.npp._id}: ${message}`);
    }
  }

  return { nppsProcessed, totalInvested, errors };
}

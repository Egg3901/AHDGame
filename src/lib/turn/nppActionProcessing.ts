/**
 * NPP Action Processing Turn Phase
 *
 * Runs every 4 turns to process actions for active Non-Player Politicians.
 * Uses the action AI to select which action each NPP takes, then executes
 * the action at full player effectiveness (the 4-turn cadence and per-cycle
 * action cap are the throttle, not a per-action discount).
 */

import type { Db, ObjectId } from "mongodb";
import type { NPP, GameConfig, PoliticalParty, Bond, StatePartyOrg } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import {
  decideNppAction,
  NPP_ACTION_COSTS,
  NPP_FUND_COSTS,
  FUNDRAISE_AP_COST,
  FUNDRAISE_FUNDS_ANCHOR_GAIN,
  getNppCampaignApCost,
  getNppCampaignFundCost,
} from "@/lib/npp/actionAi";
import { buildNppSignalLookup, type NppSignalLookup } from "@/lib/npp/actionSignals";
import { applyNppIdiosyncrasy } from "@/lib/nppAutonomy/v3/nppIdiosyncrasy";
import { politeFloatLimit } from "@/lib/nppAutonomy/playerImpactBudget";
import { advertiseFavorabilityGain, campaignInfluenceGain } from "@/lib/actions";
import { loadFxRatesByCurrency } from "@/lib/currency/corporationCapital";
import { campaignLocalRate } from "@/lib/campaigns/campaignCurrency";
import { COUNTRY_CURRENCY_MAP, type CurrencyCode } from "@/lib/constants/currencies";
import { loadTxThresholds, emitTxBulk } from "@/lib/financialTxLog/emit";
import type { FinancialTxLogEntry } from "@/lib/db/types/financialTxLog";
import { makeSeededRng } from "@/lib/events/substrate/rng";
import { getNppAutonomyLevel, nppAutonomyLevelAtLeast } from "@/lib/nppAutonomy/featureFlag";
import { getAllCountryAccess } from "@/lib/countryAccess";
import { careerArchetypeModifiersContinuous } from "@/lib/nppAutonomy/v3/careerArchetype";
import { nppBuyBond } from "@/lib/nppAutonomy/v3/finance/nppBonds";
import { nppBuyShares, nppSellShares } from "@/lib/nppAutonomy/v3/finance/nppShares";
import { nppFoundCorporation } from "@/lib/nppAutonomy/v3/finance/nppFoundCorporation";
import { nppBuildPartyOrg } from "@/lib/nppAutonomy/v3/party/nppBuildOrg";
import { BOND_UNIT_FACE_VALUE } from "@/lib/db/types/bond";
import type { Corporation } from "@/lib/db/types/corporation";
import type { CorporationType } from "@/lib/constants/corporations";
import { CORPORATION_TYPES } from "@/lib/constants/corporations";
import { resolveShareExecutionPrice } from "@/lib/corporations/marketExecution";
import { deriveCeoArchetype } from "@/lib/turn/ceoArchetype";

// Optional global salt so headless sim runs can vary the NPP action RNG across
// runs while staying reproducible within a run (set by the sim harness).
const NPP_ACTION_RNG_SALT = process.env.SIM_RNG_SALT ? `:${process.env.SIM_RNG_SALT}` : "";

// v3 = non-player-only autonomy, v4 = global — see the econActive/econGlobal
// gate in processNppActions. The ordering itself is the canonical export from
// nppAutonomy/featureFlag; this file used to keep a private copy, which is
// exactly how two call sites elsewhere ended up comparing levels with `===`.

/** Mongo filter fragment restricting a query to the autonomy country scope. */
function countryScopeFilter(scope: CountryId[] | null): Record<string, unknown> {
  return scope ? { countryId: { $in: scope } } : {};
}

/**
 * The non-player-enabled country ids from a full country-access map — the v3
 * autonomy scope (v4 lifts the restriction, so callers pass null there).
 */
export function nonPlayerCountryIds(
  access: Record<string, { enabledForPlayers: boolean }>
): CountryId[] {
  return (Object.entries(access) as [CountryId, { enabledForPlayers: boolean }][])
    .filter(([, a]) => !a.enabledForPlayers)
    .map(([id]) => id);
}

const ACTION_PROCESSING_INTERVAL = 4;
// Max actions a single NPP performs per 4-turn processing cycle. Avg ~2.5 AP/action ×4 ≈
// 9–10 AP spent vs +8 regen/cycle → AP draws down slowly from the cap. Sole throughput knob.
export const NPP_ACTIONS_PER_CYCLE = 4;
// v3 bond investment: each cycle, an NPP with savings above the reserve floor
// rolls a per-archetype-scaled chance (riskToleranceMult) to move a fraction
// of savings above that floor into an available home-currency bond. Deducted
// from savings, not funds — a risk-bearing allocation of money already set
// aside, not campaign war-chest spending. Base rate kept low: this runs
// against a shared, finite public float across every acting NPP in a
// country, so an aggressive default could drain it in one cycle.
const NPP_BOND_INVEST_RESERVE_FLOOR = 5_000;
const NPP_BOND_INVEST_BASE_PROBABILITY = 0.05;
const NPP_BOND_INVEST_FRACTION = 0.25;
// How many of the best-yielding bonds an NPP samples between, rather than always
// taking the single best. Small on purpose: this is meant to spread NPP demand
// across an issue or two, not to model a bond desk.
const NPP_BOND_CANDIDATE_POOL = 5;
// Current yield below which an NPP simply doesn't buy. Gives "hold cash" a place
// in the decision instead of always allocating. In PERCENT: `couponRate` is an
// annual rate in percent (3.5 = 3.5%) and `marketPrice` is a fraction of face
// (1.0 = par), so couponRate ÷ marketPrice is also a percent.
const NPP_BOND_MIN_YIELD_PCT = 1.0;
// Stock value signal: fundamentalSharePrice ÷ execution price, so 1.0 means the
// share trades exactly at fundamentals and below 1.0 means it's expensive. This
// is the floor a middling NPP demands; risk tolerance scales it, clamped so a
// cautious NPP asks for no better than par (never an impossible bar) and an
// aggressive one will pay up to double fundamentals.
const NPP_STOCK_MIN_VALUE_RATIO = 0.8;
const NPP_STOCK_VALUE_FLOOR_MIN = 0.5;
const NPP_STOCK_VALUE_FLOOR_MAX = 1.0;
// How many corps (by market cap) enter the weighted sample. Wider than the bond
// pool because equity is where the herding was worst — every NPP in a country
// previously bought the one largest corp.
const NPP_STOCK_CANDIDATE_POOL = 8;
// v3 stock investment: same shape as the bond sweep above, run as a separate
// gate immediately after it so an NPP can end up allocating to both in one
// cycle (each draws from whatever savings remain above the floor at the time
// it runs — sequential, same document, no double-count risk). Picks the
// single largest eligible home-currency corp by market cap (blue-chip bias,
// same "always highest X" simplicity as the bond sweep's highest-couponRate
// pick) rather than diversifying across a basket — that's index funds' job.
const NPP_STOCK_INVEST_RESERVE_FLOOR = 5_000;
const NPP_STOCK_INVEST_BASE_PROBABILITY = 0.05;
const NPP_STOCK_INVEST_FRACTION = 0.25;
// v3 party-org building: counteracts processPartyOrgTurn's unconditional
// per-turn Org decay, which nothing has ever offset autonomously (growth was
// player-`/build-org`-only). Runs over EXISTING statePartyOrg rows with
// presence (not every possible state×party pair) — narrower scope than the
// player route, sufficient to stop the long-run decay-to-zero this exists to
// fix. Gated by campaignAggressionMult (org-building is a form of
// organizing/campaigning), same probability shape as the bond/stock sweeps.
const NPP_BUILD_ORG_BASE_PROBABILITY = 0.15;
// v3 stock-sell: NPPs occasionally take profits / rebalance out of an
// existing position — the counterpart to the stock-BUY sweep above. Iterates
// corporations (bounded by corp count, not NPP count — far fewer corps than
// NPPs hold shares) rather than NPPs, since only a fraction of NPPs actually
// hold a position at any point. Flat base probability (portfolio rebalancing
// isn't strongly personality-driven the way investing IN is) rather than
// archetype-scaled.
const NPP_STOCK_SELL_BASE_PROBABILITY = 0.03;
const NPP_STOCK_SELL_FRACTION = 0.5; // sells half the position when it fires
// v3 corporation founding: the natural next step after buy/sell — a
// sufficiently wealthy, entrepreneurial NPP starts their own company. Gated
// on ceoArchetype (aggressive/innovator — high ambition — found more often
// than cautious/costCutter) rather than the political careerArchetype,
// since "should I become a CEO" is thematically a corporate-behavior
// decision. Funds threshold is FOUNDING_FEE × a buffer so an NPP doesn't
// spend down to exactly zero on a single roll. Flat local-currency-
// equivalent constant, not anchor-converted — same simplification the
// bond/stock reserve floors above already use.
const NPP_FOUNDING_FEE = 100_000;
const NPP_FOUNDING_FUNDS_BUFFER = 1.5;
const NPP_FOUNDING_BASE_PROBABILITY_BY_ARCHETYPE: Record<
  ReturnType<typeof deriveCeoArchetype>,
  number
> = {
  // Autonomy bump (t834): roughly doubled from {0.08,0.06,0.02,0.01}. NPP corps
  // are economically negligible (~0.09% of total market cap) and now sorted to
  // the bottom of / hidden from the exchange list, so a faster organic founding
  // rate adds market texture without crowding players or moving prices.
  aggressive: 0.15,
  innovator: 0.12,
  cautious: 0.05,
  costCutter: 0.03,
};
// How many of the wealthiest eligible NPPs per cycle even get considered —
// bounds the query instead of scanning all NPPs for "funds above threshold".
// Raised 200 → 300 alongside the probability bump to widen organic founding.
const NPP_FOUNDING_CANDIDATE_POOL = 300;

export interface NppActionProcessingResult {
  nppsProcessed: number;
  actionsExecuted: number;
  buildDonorBase: number;
  campaign: number;
  advertise: number;
  partyDonation: number;
  /** Funds-poor fallback fires (see actionAi.ts's FUNDRAISE_* constants). */
  fundraise: number;
  skipped: number;
}

function zeroResult(): NppActionProcessingResult {
  return {
    nppsProcessed: 0,
    actionsExecuted: 0,
    buildDonorBase: 0,
    campaign: 0,
    advertise: 0,
    partyDonation: 0,
    fundraise: 0,
    skipped: 0,
  };
}

function getApCost(action: string, donorBaseLevel: number, politicalInfluence: number): number {
  if (action === "campaign") return getNppCampaignApCost(politicalInfluence);
  if (action === "buildDonorBase") {
    return NPP_ACTION_COSTS.buildDonorBase[Math.min(donorBaseLevel, 4)];
  }
  return NPP_ACTION_COSTS[action as keyof typeof NPP_ACTION_COSTS] as number;
}

function getFundCost(action: string, donorBaseLevel: number, politicalInfluence: number): number {
  if (action === "campaign") return getNppCampaignFundCost(politicalInfluence);
  if (action === "buildDonorBase") {
    return NPP_FUND_COSTS.buildDonorBase[Math.min(donorBaseLevel, 4)];
  }
  return NPP_FUND_COSTS[action as keyof typeof NPP_FUND_COSTS] as number;
}

export async function processNppActions(
  db: Db,
  currentTurn: number
): Promise<NppActionProcessingResult> {
  // Only process every 4 turns
  if (currentTurn % ACTION_PROCESSING_INTERVAL !== 0) {
    return zeroResult();
  }

  // NPP economy is on by default; only an explicit `false` disables it.
  const config = await db.collection<GameConfig>("gameConfig").findOne({ _id: "default" });
  if (config?.nppEconomyEnabled === false) {
    return zeroResult();
  }

  // NPP economic + full-agency autonomy graduates in two final steps:
  //   v3 — full agency, but scoped to NON-player-enabled countries only (the
  //        NPP-driven markets, so autonomy runs wild where no players compete).
  //   v4 — the same, applied GLOBALLY (player-enabled countries included).
  // Below v3 the decision path is byte-identical to the pre-v3 logic.
  const level = await getNppAutonomyLevel(db);
  const econActive = nppAutonomyLevelAtLeast(level, "v3"); // v3 or v4
  const econGlobal = nppAutonomyLevelAtLeast(level, "v4"); // v4 only

  // Country scope for autonomy: null ⇒ no restriction (v4 / global). At v3 it is
  // the set of non-player-enabled countries, so player markets stay untouched.
  const econScopeCountries =
    econActive && !econGlobal ? nonPlayerCountryIds(await getAllCountryAccess(db)) : null;
  const econScopeSet = econScopeCountries ? new Set<CountryId>(econScopeCountries) : null;

  const result = zeroResult();

  // Party treasury accumulator for partyDonation actions (values in LOCAL units —
  // party.treasury is local home-currency post-cf-inconsistency-fix Phase 6).
  const partyTreasuryUpdates = new Map<string, { amount: number; _id: ObjectId }>();

  // npp.funds is local home-currency (post-cf-inconsistency-fix Phase 8 for
  // NPPs). NPP_FUND_COSTS constants are anchor for cross-country game-balance
  // parity; convert at the boundary for each NPP based on its home country rate.
  //
  // Deliberately the FROZEN campaignLocalRate, not the live exchangeRates rate:
  // processNppFundGeneration credits npp.funds by converting anchor generation
  // to local at campaignLocalRate (frozen, era-blind — see its own doc comment),
  // so this decision-time conversion has to use the identical rate to read back
  // what was actually credited. Mixing a live/era-correct rate in here while
  // generation stays frozen silently rescales every NPP's perceived purchasing
  // power by (frozen rate ÷ live rate) — confirmed in a 654-turn 1953 world: AT's
  // frozen rate (13.4, the flat 2019-era table) sat at roughly half its live/era
  // rate (~26), so AT NPPs' spendable anchor balance read ~2x lower than what
  // they'd actually banked, leaving whole cohorts sitting on funds worth less
  // than the cheapest action forever. Live rates remain correct for the bond/
  // stock/founding sweeps below — those buy real market-priced instruments and
  // each load their own fxByCcy independently.
  const rateForCountry = (countryId: string): number => campaignLocalRate(countryId);

  // Parties, loaded ONCE up front and keyed "countryId:sequentialId". This query
  // used to run after the NPP loop purely to resolve treasury-flush targets; it
  // is hoisted because the v3+ brain also reads party treasury as a decision
  // signal. Same query, same cost — just earlier — and the flush below reuses the
  // map instead of re-fetching.
  //
  // Deliberately NOT scoped to econScopeCountries: the loop below processes every
  // NPP regardless of autonomy scope, and out-of-scope NPPs still make party
  // donations that have to land somewhere. Party documents number a handful per
  // country, so loading all of them beats a scoped query plus a second lookup.
  const partiesByKey = new Map<
    string,
    {
      _id: ObjectId;
      treasury: number;
      name: string;
      countryId: CountryId;
      sequentialId: string;
    }
  >();
  {
    const parties = await db
      .collection<PoliticalParty>("politicalParties")
      .find({}, { projection: { _id: 1, sequentialId: 1, countryId: 1, treasury: 1, name: 1 } })
      .toArray();
    for (const party of parties) {
      partiesByKey.set(`${party.countryId ?? "US"}:${party.sequentialId}`, {
        _id: party._id,
        treasury: Number.isFinite(party.treasury) ? (party.treasury as number) : 0,
        name: party.name,
        countryId: (party.countryId ?? "US") as CountryId,
        sequentialId: String(party.sequentialId),
      });
    }
  }

  // World-state signals for the v3+ brain. Three fixed queries, resolved from
  // in-memory maps inside the per-NPP loop — never a round trip per NPP.
  let signalLookup: NppSignalLookup | null = null;
  if (econActive) {
    signalLookup = await buildNppSignalLookup(db, currentTurn, econScopeCountries, partiesByKey);
  }

  // Query NPPs with at least 1 action point. Technocrat NPPs (e.g.
  // autonomous central-bank chairs) are excluded via isTechnocrat: { $ne: true }
  // — they hold non-political office and don't take campaign actions.
  const cursor = db
    .collection<NPP>("npps")
    .find({ retiredAt: null, actionPoints: { $gte: 1 }, isTechnocrat: { $ne: true } });

  const nppOps: {
    updateOne: {
      filter: { _id: ObjectId };
      update: object;
    };
  }[] = [];

  for await (const npp of cursor) {
    result.nppsProcessed++;

    // Use finite guard: ?? only catches null/undefined, not NaN
    const finite = (v: number | undefined | null) => (Number.isFinite(v) ? (v as number) : 0);
    const homeRate = rateForCountry(npp.countryId ?? "US");
    const hasOffice = npp.currentOffice !== null && npp.currentOffice !== undefined;

    // Mutable per-cycle state, decremented as each action fires. decideNppAction's gating
    // compares against ANCHOR-denominated NPP_FUND_COSTS, so track funds in anchor and
    // convert each spend back to local for the $inc on npp.funds.
    let apRemaining = finite(npp.actionPoints);
    let fundsAnchorRemaining = finite(npp.funds) / homeRate;
    let donorBaseLevel = finite(npp.donorBaseLevel);

    // Accumulated deltas → one write per NPP.
    let apSpent = 0;
    let fundSpentLocal = 0;
    // Funds-poor fallback (fundraise) credits rather than spends; kept separate from
    // fundSpentLocal so the final $inc nets gains against spends in one write.
    let fundGainedLocal = 0;
    let nCampaign = 0;
    let nAdvertise = 0;
    let nBuild = 0;
    let donationFundLocal = 0;
    let actionsThisCycle = 0;
    // Running favorability so each advertise in the cycle is taxed against the
    // updated value, exactly like a player firing several ads in a row.
    let favAccrued = finite(npp.favorability);
    // Running political influence so each campaign in the cycle both gains
    // AND costs against the updated value — campaignInfluenceGain's diminishing
    // return and getNppCampaignApCost/getNppCampaignFundCost's escalating tier
    // both key off the CURRENT influence, exactly like the player's own
    // Campaign action and like favAccrued above for advertise.
    let piAccrued = finite(npp.politicalInfluence);

    // Deterministic per-NPP, per-cycle RNG: replaces Math.random in the action
    // AI so turns are replay-safe and headless sims are reproducible. Keyed on
    // the stable sequentialId (not the bootstrap-random _id) so identical seed
    // presets reproduce the same action stream.
    const actionRng = makeSeededRng(
      `npp-action:${npp.sequentialId ?? npp._id.toString()}:${npp.countryId ?? "US"}:${currentTurn}${NPP_ACTION_RNG_SALT}`
    );

    // v3+: archetype-weighted priorities, honoring the country scope (at v3 only
    // NPPs in non-player countries get them). undefined ⇒ no-op below v3.
    const inEconScope = !econScopeSet || econScopeSet.has((npp.countryId ?? "US") as CountryId);
    const v3Brain = econActive && inEconScope;

    // Archetype → continuous blend (so ambition 51 and ambition 99 stop being the
    // same politician) → this NPP's own persistent quirks.
    const nppKey = String(npp.sequentialId ?? npp._id.toString());
    const idiosyncrasy = v3Brain
      ? applyNppIdiosyncrasy(
          careerArchetypeModifiersContinuous(npp.personality),
          nppKey,
          currentTurn
        )
      : null;
    const careerModifiers = idiosyncrasy?.modifiers;
    const signals = v3Brain && signalLookup ? signalLookup.signalsFor(npp) : undefined;

    // Carried across the cycle so an NPP follows through on what they started
    // rather than re-rolling independently four times.
    let lastAction: "buildDonorBase" | "campaign" | "advertise" | "partyDonation" | undefined;

    while (actionsThisCycle < NPP_ACTIONS_PER_CYCLE) {
      const decision = decideNppAction(
        {
          hasOffice,
          personality: npp.personality,
          funds: fundsAnchorRemaining,
          actionPoints: apRemaining,
          donorBaseLevel,
          favorability: favAccrued,
          politicalInfluence: piAccrued,
        },
        actionRng,
        careerModifiers,
        signals
          ? { signals, lastAction, temperatureMult: idiosyncrasy?.temperatureMult }
          : undefined
      );

      // "none" covers no-affordable-action and the save heuristic — end the cycle.
      if (decision.action === "none") break;

      // Funds-poor fallback: AP-only cost, funds GAIN rather than spend, and no entry
      // in NPP_ACTION_COSTS/NPP_FUND_COSTS (it isn't one of the priority-weighted
      // actions — decideNppAction only ever returns it as a last resort). Handled
      // before the cost-table lookups below, which don't know this action exists.
      // lastAction is deliberately left untouched: fundraise sits outside the
      // priority/commitment-bonus mechanism entirely.
      if (decision.action === "fundraise") {
        if (apRemaining < FUNDRAISE_AP_COST) break; // defensive re-guard, same as below
        apRemaining -= FUNDRAISE_AP_COST;
        apSpent += FUNDRAISE_AP_COST;
        fundsAnchorRemaining += FUNDRAISE_FUNDS_ANCHOR_GAIN;
        fundGainedLocal += FUNDRAISE_FUNDS_ANCHOR_GAIN * homeRate;
        result.fundraise++;
        actionsThisCycle++;
        result.actionsExecuted++;
        continue;
      }

      const action = decision.action;
      const apCost = getApCost(action, donorBaseLevel, piAccrued);
      const fundCostAnchor = getFundCost(action, donorBaseLevel, piAccrued);

      // Defensive re-guard: decideNppAction already gates affordability, but never let a
      // rounding/edge case push AP or funds negative.
      if (apRemaining < apCost || fundsAnchorRemaining < fundCostAnchor) break;

      const fundCostLocal = fundCostAnchor * homeRate;
      apRemaining -= apCost;
      fundsAnchorRemaining -= fundCostAnchor;
      apSpent += apCost;
      fundSpentLocal += fundCostLocal;

      switch (action) {
        case "buildDonorBase":
          nBuild++;
          donorBaseLevel++; // next iteration's cost uses the new level
          result.buildDonorBase++;
          break;
        case "campaign":
          piAccrued = Math.min(100, piAccrued + campaignInfluenceGain(piAccrued));
          nCampaign++;
          result.campaign++;
          break;
        case "advertise":
          favAccrued = Math.min(100, favAccrued + advertiseFavorabilityGain(favAccrued));
          nAdvertise++;
          result.advertise++;
          break;
        case "partyDonation":
          donationFundLocal += fundCostLocal;
          result.partyDonation++;
          break;
      }

      lastAction = action;
      actionsThisCycle++;
      result.actionsExecuted++;
    }

    if (actionsThisCycle === 0) {
      result.skipped++;
      continue;
    }

    // NPP actions run at full player effectiveness: campaign +1 influence per
    // action with the same >50% diminishing returns players get (accrued
    // sequentially above via piAccrued), advertise +3 favorability per action
    // with the same >70% diminishing returns (accrued sequentially via
    // favAccrued). Both are already clamped at 100 per action.
    const setUpdate: Record<string, number> = {};
    if (nCampaign > 0) {
      setUpdate.politicalInfluence = piAccrued;
    }
    if (nAdvertise > 0) {
      setUpdate.favorability = favAccrued;
    }
    if (nBuild > 0) {
      setUpdate.donorBaseLevel = donorBaseLevel; // start + nBuild
    }

    // Campaign/economy wall: post-spend campaign surplus STAYS in `funds` (the
    // political war chest). It is deliberately NOT swept into personal savings
    // or any real-economy account — campaign money never becomes personal
    // wealth. NPP personal/investment capital is the separate GDP-income-fed
    // `nppInvestmentCashAnchor` (see nppEconomicAccount.ts / index-fund cron).
    const incUpdate: Record<string, number> = {
      actionPoints: -apSpent,
      funds: fundGainedLocal - fundSpentLocal,
    };
    const update: { $inc: Record<string, number>; $set?: Record<string, number> } = {
      $inc: incUpdate,
    };
    if (Object.keys(setUpdate).length > 0) update.$set = setUpdate;

    nppOps.push({ updateOne: { filter: { _id: npp._id }, update } });

    // Accumulate party-donation funds (local) for the treasury flush below.
    if (donationFundLocal > 0 && npp.party !== "independent") {
      const nppCountryId = npp.countryId ?? "US";
      const existingKey = `${nppCountryId}:${npp.party}`;
      const existing = partyTreasuryUpdates.get(existingKey);
      if (existing) {
        existing.amount += donationFundLocal;
      } else {
        // Store countryId and sequentialId for later party lookup
        partyTreasuryUpdates.set(existingKey, { amount: donationFundLocal, _id: npp._id });
      }
    }
  }

  // Flush NPP updates
  if (nppOps.length > 0) {
    await db.collection<NPP>("npps").bulkWrite(nppOps);
  }

  // Update party treasuries. Keys are composite "countryId:sequentialId"
  // (e.g. "US:4", "UK:2") and resolve against the map loaded before the loop —
  // this used to be a second `politicalParties` query built from an `$or` of
  // every touched pair.
  if (partyTreasuryUpdates.size > 0) {
    const partyOps = [...partyTreasuryUpdates.entries()]
      .map(([compositeKey, entry]) => {
        const party = partiesByKey.get(compositeKey);
        if (!party) return null;
        return {
          updateOne: {
            filter: { _id: party._id },
            update: { $inc: { treasury: entry.amount } },
          },
        };
      })
      .filter((op): op is NonNullable<typeof op> => op !== null);

    if (partyOps.length > 0) {
      await db.collection<PoliticalParty>("politicalParties").bulkWrite(partyOps);

      const txEntries: Omit<FinancialTxLogEntry, "_id" | "expiresAt" | "flagged">[] = [];
      for (const [compositeKey, entry] of partyTreasuryUpdates) {
        const party = partiesByKey.get(compositeKey);
        if (!party || entry.amount <= 0) continue;
        txEntries.push({
          type: "party_dues_received",
          turn: currentTurn,
          createdAt: new Date(),
          subjectType: "party",
          subjectId: party._id,
          subjectName: party.name,
          amount: entry.amount,
          currencyCode: (COUNTRY_CURRENCY_MAP[party.countryId] ?? "USD") as CurrencyCode,
          counterpartyType: "system",
          counterpartyName: "NPP party donation",
          meta: {
            scope: "national",
            partyId: party.sequentialId,
            source: "npp_party_donation",
          },
        });
      }
      if (txEntries.length > 0) {
        const thresholds = await loadTxThresholds(db);
        await emitTxBulk(db, txEntries, thresholds);
      }
    }
  }

  if (econActive) {
    await investNppBondSurplus(db, currentTurn, econScopeCountries);
    await investNppStockSurplus(db, currentTurn, econScopeCountries);
    await sellNppStockSurplus(db, currentTurn, econScopeCountries);
    await buildNppPartyOrgSurplus(db, currentTurn, econScopeCountries);
    await foundNppCorporationsSurplus(db, currentTurn, econScopeCountries);
  }

  return result;
}

/**
 * v3 bond-investment sweep — decision-loop wiring for nppBuyBond (the command
 * core existed and was tested since the initial finance-vertical work, but
 * nothing autonomous ever called it; found via the headless sim harness that
 * bond holdings stayed at zero across every real run). Runs after the main
 * batched action cycle (so it sees this cycle's post-spend savings, not stale
 * pre-cycle values) and uses nppBuyBond directly rather than folding into the
 * batched $inc — a bond purchase touches the shared, finite public float on a
 * SEPARATE collection and needs nppBuyBond's own atomic
 * deduct-then-reserve-with-refund protection, unlike the savings sweep (a
 * same-document balance move that's safe to fold into the batch).
 */
async function investNppBondSurplus(
  db: Db,
  currentTurn: number,
  countryScope: CountryId[] | null = null
): Promise<void> {
  // Investment capital is the personal forex account (₳), NOT campaign funds
  // and NOT savings — the full campaign/economy wall.
  const cursor = db.collection<NPP>("npps").find(
    {
      retiredAt: null,
      nppInvestmentCashAnchor: { $gt: NPP_BOND_INVEST_RESERVE_FLOOR },
      ...countryScopeFilter(countryScope),
    },
    { projection: { countryId: 1, personality: 1, nppInvestmentCashAnchor: 1 } }
  );

  const bondsByCountry = new Map<CountryId, Bond[]>();
  const rng = makeSeededRng(`npp-bond-invest:${currentTurn}${NPP_ACTION_RNG_SALT}`);
  const fxByCcy = await loadFxRatesByCurrency(db);

  for await (const npp of cursor) {
    const countryId = (npp.countryId ?? "US") as CountryId;
    const homeCurrency = COUNTRY_CURRENCY_MAP[countryId] ?? "USD";
    const cashAnchor = npp.nppInvestmentCashAnchor ?? 0;
    if (cashAnchor <= NPP_BOND_INVEST_RESERVE_FLOOR) continue;

    const { riskToleranceMult, saveInvestAppetiteMult } = careerArchetypeModifiersContinuous(
      npp.personality
    );
    if (rng() >= NPP_BOND_INVEST_BASE_PROBABILITY * riskToleranceMult) continue;

    if (!bondsByCountry.has(countryId)) {
      const bonds = await db
        .collection<Bond>("bonds")
        .find(
          { countryId, maturityTurn: { $gt: currentTurn }, publicFloat: { $gt: 0 } },
          {
            projection: {
              currencyCode: 1,
              countryId: 1,
              publicFloat: 1,
              marketPrice: 1,
              couponRate: 1,
            },
          }
        )
        .sort({ couponRate: -1 })
        .toArray();
      bondsByCountry.set(countryId, bonds);
    }
    // Candidate selection used to be "always the single highest couponRate bond
    // in the country", which meant every NPP in a country bought the same issue —
    // maximally predictable and maximally concentrated. Rank by CURRENT yield
    // (coupon relative to what the bond actually costs, which is the number an
    // investor would care about), then sample from the top few weighted by yield,
    // sharpened by risk tolerance so a cautious NPP is likelier to take the safe
    // obvious pick and an aggressive one reaches further down the list.
    const eligibleBonds = bondsByCountry
      .get(countryId)!
      .filter(
        (b) =>
          (b.currencyCode ?? COUNTRY_CURRENCY_MAP[countryId] ?? "USD") === homeCurrency &&
          b.publicFloat > 0 &&
          b.marketPrice > 0
      );
    if (eligibleBonds.length === 0) continue;

    const scoredBonds = eligibleBonds
      .map((b) => ({ bond: b, yield: b.couponRate / b.marketPrice }))
      .sort((a, b) => b.yield - a.yield)
      .slice(0, NPP_BOND_CANDIDATE_POOL);

    // Nothing worth buying — capital simply stays put. An NPP declining to
    // invest is a decision, and it is the one that stops them from mechanically
    // buying whatever is least bad every single cycle.
    if (scoredBonds[0].yield < NPP_BOND_MIN_YIELD_PCT) continue;

    const bondWeights = scoredBonds.map((s) => Math.pow(s.yield, riskToleranceMult));
    const bondTotal = bondWeights.reduce((s, w) => s + w, 0);
    let bondRoll = rng() * bondTotal;
    let bond = scoredBonds[scoredBonds.length - 1].bond;
    for (let i = 0; i < scoredBonds.length; i++) {
      bondRoll -= bondWeights[i];
      if (bondRoll <= 0) {
        bond = scoredBonds[i].bond;
        break;
      }
    }

    // Size the buy in ₳, then convert to LOCAL to count units at local prices.
    // saveInvestAppetiteMult finally does something here: it was defined, tested
    // and clamped but read by nothing, so every NPP allocated an identical
    // fraction of surplus. Stewards (0.8) now commit roughly double what
    // reformers (0.3) do — variance in SIZE, not just in timing.
    const homeRate = fxByCcy.get(homeCurrency) ?? 1;
    const appetite = Math.min(Math.max(saveInvestAppetiteMult / 0.4, 0.5), 2.0);
    const investAmountAnchor =
      (cashAnchor - NPP_BOND_INVEST_RESERVE_FLOOR) * NPP_BOND_INVEST_FRACTION * appetite;
    const investAmountLocal = investAmountAnchor * (homeRate > 0 ? homeRate : 1);
    const unitCost = BOND_UNIT_FACE_VALUE * bond.marketPrice;
    // Never clear an issue: leave a reserve of the float so a player always has
    // something to buy. Being quietly outbid on every bond in the country is the
    // most annoying kind of competition — there's no event to read and nothing
    // to react to, the market is just empty.
    const units = Math.min(
      Math.floor(investAmountLocal / unitCost),
      politeFloatLimit(bond.publicFloat)
    );
    if (units < 1) continue;

    // nppBuyBond debits nppInvestmentCashAnchor atomically (guarded); a failed
    // float race leaves the ₳ untouched — no plumbing move needed here anymore.
    const result = await nppBuyBond(db, npp, bond._id, units, currentTurn, homeRate);
    if (result.ok) {
      bond.publicFloat -= units;
    }
  }
}

/** Fields loaded per candidate corp for stock-sweep selection; keeps the find() projection tight. */
type StockCandidateCorp = Pick<
  Corporation,
  | "_id"
  | "liquidCurrencyCode"
  | "sharePrice"
  | "fundamentalSharePrice"
  | "totalShares"
  | "publicFloat"
>;

/**
 * v3 stock-investment sweep — the individual-share-purchase counterpart to
 * `investNppBondSurplus`, using the same command-core-then-sweep shape
 * (`nppBuyShares`, built the same way `nppBuyBond` was). Runs after the bond
 * sweep so both can spend from the same cycle's post-spend savings without
 * double-counting (sequential passes over the same document).
 */
async function investNppStockSurplus(
  db: Db,
  currentTurn: number,
  countryScope: CountryId[] | null = null
): Promise<void> {
  void currentTurn; // kept for signature symmetry with the bond sweep; not needed by nppBuyShares.

  const cursor = db.collection<NPP>("npps").find(
    {
      retiredAt: null,
      nppInvestmentCashAnchor: { $gt: NPP_STOCK_INVEST_RESERVE_FLOOR },
      ...countryScopeFilter(countryScope),
    },
    { projection: { countryId: 1, personality: 1, nppInvestmentCashAnchor: 1 } }
  );

  const corpsByCountry = new Map<CountryId, StockCandidateCorp[]>();
  const rng = makeSeededRng(`npp-stock-invest:${currentTurn}${NPP_ACTION_RNG_SALT}`);
  const fxByCcy = await loadFxRatesByCurrency(db);

  for await (const npp of cursor) {
    const countryId = (npp.countryId ?? "US") as CountryId;
    const homeCurrency = COUNTRY_CURRENCY_MAP[countryId] ?? "USD";
    const cashAnchor = npp.nppInvestmentCashAnchor ?? 0;
    if (cashAnchor <= NPP_STOCK_INVEST_RESERVE_FLOOR) continue;

    const { riskToleranceMult, saveInvestAppetiteMult } = careerArchetypeModifiersContinuous(
      npp.personality
    );
    if (rng() >= NPP_STOCK_INVEST_BASE_PROBABILITY * riskToleranceMult) continue;

    if (!corpsByCountry.has(countryId)) {
      const corps = await db
        .collection<Corporation>("corporations")
        .find(
          {
            countryId,
            isPrivate: { $ne: true },
            hiddenFromExchange: { $ne: true },
            isNationalized: { $ne: true },
            countryOwnerId: { $exists: false },
            sharePrice: { $gt: 0 },
            totalShares: { $gt: 0 },
            publicFloat: { $gt: 0 },
          },
          {
            projection: {
              liquidCurrencyCode: 1,
              sharePrice: 1,
              fundamentalSharePrice: 1,
              totalShares: 1,
              publicFloat: 1,
            },
          }
        )
        .toArray();
      corps.sort((a, b) => b.sharePrice * b.totalShares - a.sharePrice * a.totalShares);
      corpsByCountry.set(countryId, corps);
    }
    // Selection used to be `.find(first match)` on a market-cap-sorted list —
    // i.e. every NPP in the country bought the single largest corp, forever.
    // Now: take the top N by size, score each on a value signal
    // (fundamentalSharePrice ÷ execution price, already projected above and
    // previously unused), and sample. Risk-tolerant NPPs weight size and chase
    // momentum; cautious ones weight the discount and refuse to overpay.
    const eligibleCorps = corpsByCountry
      .get(countryId)!
      .filter((c) => (c.liquidCurrencyCode ?? "USD") === homeCurrency && (c.publicFloat ?? 0) > 0)
      .slice(0, NPP_STOCK_CANDIDATE_POOL);
    if (eligibleCorps.length === 0) continue;

    // Risk tolerance relaxes the "don't overpay" floor: a cautious NPP wants the
    // share at or below fundamentals, an aggressive one will pay well above.
    // Clamped at 1.0 so the cautious end never becomes a bar nothing clears —
    // and so a corp with no `fundamentalSharePrice` (ratio defaults to 1) is
    // always eligible rather than silently excluded from every NPP's universe.
    const minValueRatio = Math.min(
      Math.max(NPP_STOCK_MIN_VALUE_RATIO * (2 - riskToleranceMult), NPP_STOCK_VALUE_FLOOR_MIN),
      NPP_STOCK_VALUE_FLOOR_MAX
    );
    const scoredCorps = eligibleCorps
      .map((c) => {
        const price = resolveShareExecutionPrice(c);
        const marketCap = (c.sharePrice ?? 0) * (c.totalShares ?? 0);
        const valueRatio = price > 0 ? (c.fundamentalSharePrice ?? price) / price : 0;
        return { corp: c, price, valueRatio, marketCap };
      })
      .filter((s) => s.price > 0 && s.valueRatio >= minValueRatio);
    // Everything on offer is overvalued for this NPP's taste — hold the cash.
    if (scoredCorps.length === 0) continue;

    const corpWeights = scoredCorps.map(
      (s) => Math.sqrt(Math.max(s.marketCap, 1)) * Math.pow(s.valueRatio, riskToleranceMult)
    );
    const corpTotal = corpWeights.reduce((sum, w) => sum + w, 0);
    let corpRoll = rng() * corpTotal;
    let chosen = scoredCorps[scoredCorps.length - 1];
    for (let i = 0; i < scoredCorps.length; i++) {
      corpRoll -= corpWeights[i];
      if (corpRoll <= 0) {
        chosen = scoredCorps[i];
        break;
      }
    }
    const corp = chosen.corp;
    const executionPrice = chosen.price;

    // Size the buy in ₳, then convert to LOCAL to count shares at local prices.
    const homeRate = fxByCcy.get(homeCurrency) ?? 1;
    const appetite = Math.min(Math.max(saveInvestAppetiteMult / 0.4, 0.5), 2.0);
    const investAmountAnchor =
      (cashAnchor - NPP_STOCK_INVEST_RESERVE_FLOOR) * NPP_STOCK_INVEST_FRACTION * appetite;
    const investAmountLocal = investAmountAnchor * (homeRate > 0 ? homeRate : 1);
    // Leave a reserve of the float untouched — see the bond sweep.
    const shares = Math.min(
      Math.floor(investAmountLocal / executionPrice),
      politeFloatLimit(corp.publicFloat ?? 0)
    );
    if (shares < 1) continue;

    // nppBuyShares debits nppInvestmentCashAnchor atomically (guarded); a failed
    // float race leaves the ₳ untouched — no plumbing move needed here anymore.
    const result = await nppBuyShares(db, npp, corp._id, shares, homeRate);
    if (result.ok) {
      corp.publicFloat = (corp.publicFloat ?? 0) - shares;
    }
  }
}

/**
 * v3 party-org-building sweep — the missing counteraction to
 * `processPartyOrgTurn`'s unconditional decay (see constant comment above).
 * Iterates EXISTING statePartyOrg rows with presence, samples an acting NPP per
 * row weighted by campaign aggression, and rolls a campaignAggressionMult-scaled
 * chance to have them trigger `nppBuildPartyOrg` for that row.
 *
 * Two things changed from the original: the actor was picked as the lowest `_id`
 * in the state — so the SAME NPP was forever the local organiser, which reads as
 * scripted rather than autonomous — and the pool was fetched with one query per
 * row, an O(rows) round-trip loop inside a turn phase. Both are fixed by loading
 * every candidate once and grouping in memory.
 */
async function buildNppPartyOrgSurplus(
  db: Db,
  currentTurn: number,
  countryScope: CountryId[] | null = null
): Promise<void> {
  const rows = await db
    .collection<StatePartyOrg>("statePartyOrg")
    .find(
      { hasPresence: true, ...countryScopeFilter(countryScope) },
      { projection: { countryId: 1, stateId: 1, partyId: 1 } }
    )
    .toArray();
  if (rows.length === 0) return;

  // One query for every possible actor, grouped by the same key the rows use.
  const actorsByKey = new Map<string, Pick<NPP, "_id" | "personality">[]>();
  {
    const actorCursor = db.collection<NPP>("npps").find(
      {
        retiredAt: null,
        homeState: { $in: [...new Set(rows.map((r) => r.stateId))] },
        ...countryScopeFilter(countryScope),
      },
      { projection: { _id: 1, personality: 1, countryId: 1, homeState: 1, party: 1 } }
    );
    for await (const actor of actorCursor) {
      const key = `${actor.countryId ?? "US"}:${actor.homeState}:${actor.party}`;
      const list = actorsByKey.get(key) ?? [];
      list.push(actor);
      actorsByKey.set(key, list);
    }
    // Stable order so the weighted sample below is reproducible.
    for (const list of actorsByKey.values()) {
      list.sort((a, b) => (a._id.toString() < b._id.toString() ? -1 : 1));
    }
  }

  const rng = makeSeededRng(`npp-build-org:${currentTurn}${NPP_ACTION_RNG_SALT}`);

  for (const row of rows) {
    const countryId = row.countryId as CountryId;
    const partySeq = Number(row.partyId);
    if (!Number.isFinite(partySeq)) continue;

    const pool = actorsByKey.get(`${countryId}:${row.stateId}:${row.partyId}`) ?? [];
    if (pool.length === 0) continue;

    // Sample the organiser weighted by campaign aggression — the local firebrand
    // is more likely to be the one doing the work, not guaranteed to be.
    const weights = pool.map((a) =>
      Math.max(0.01, careerArchetypeModifiersContinuous(a.personality).campaignAggressionMult)
    );
    const total = weights.reduce((s, w) => s + w, 0);
    let roll = rng() * total;
    let actor = pool[pool.length - 1];
    for (let i = 0; i < pool.length; i++) {
      roll -= weights[i];
      if (roll <= 0) {
        actor = pool[i];
        break;
      }
    }

    const { campaignAggressionMult } = careerArchetypeModifiersContinuous(actor.personality);
    if (rng() >= NPP_BUILD_ORG_BASE_PROBABILITY * campaignAggressionMult) continue;

    await nppBuildPartyOrg(db, actor._id, countryId, row.stateId, partySeq, currentTurn);
  }
}

/**
 * v3 stock-sell sweep — the counterpart to `investNppStockSurplus`. Iterates
 * corporations (bounded by corp count) rather than NPPs, since only a
 * fraction of NPPs actually hold a share position at any point — far
 * cheaper than scanning every NPP to find the ones who happen to hold
 * stock. Batches the NPP-countryId lookup (needed by nppSellShares' home-
 * currency scope check) into one query rather than per-holding.
 *
 * Excludes a corp's own CEO from selling THAT corp's stock. Found via a
 * real sim run: CEO_INITIAL_SHARES is 10,000,000 and the founding CEO holds
 * 51% of it (~5.1M shares) — the SAME flat probability/fraction that's a
 * sensible "occasionally trim a small position" for a passive shareholder
 * would instead liquidate millions of shares of a CEO's own controlling
 * stake in one action, producing implausible proceeds and visibly skewing
 * wealth-concentration metrics (Gini 0.51-0.65 → 0.72, top-1% share 4-5% →
 * 19% in one run). A CEO divesting their own company is a fundamentally
 * different, much higher-stakes decision this sweep was never designed for.
 */
async function sellNppStockSurplus(
  db: Db,
  currentTurn: number,
  countryScope: CountryId[] | null = null
): Promise<void> {
  const corps = await db
    .collection<Corporation>("corporations")
    .find(
      { "shareholders.nppId": { $exists: true }, ...countryScopeFilter(countryScope) },
      // Price fields widen the projection but not the query — same round trip,
      // and they turn a blind coin flip into an actual sell decision.
      {
        projection: {
          shareholders: 1,
          ceoId: 1,
          sharePrice: 1,
          fundamentalSharePrice: 1,
          totalShares: 1,
          publicFloat: 1,
          liquidCurrencyCode: 1,
        },
      }
    )
    .toArray();
  if (corps.length === 0) return;

  const nppIdByString = new Map<string, ObjectId>();
  for (const corp of corps) {
    for (const sh of corp.shareholders ?? []) {
      if (sh.nppId && (sh.shares ?? 0) > 0) nppIdByString.set(sh.nppId.toString(), sh.nppId);
    }
  }
  if (nppIdByString.size === 0) return;

  const nppDocs = await db
    .collection<NPP>("npps")
    .find(
      { _id: { $in: [...nppIdByString.values()] } },
      { projection: { countryId: 1, personality: 1 } }
    )
    .toArray();
  const countryById = new Map(nppDocs.map((n) => [n._id.toString(), n.countryId]));
  const personalityById = new Map(nppDocs.map((n) => [n._id.toString(), n.personality]));

  const rng = makeSeededRng(`npp-stock-sell:${currentTurn}${NPP_ACTION_RNG_SALT}`);
  const fxByCcy = await loadFxRatesByCurrency(db);

  for (const corp of corps) {
    // Sell pressure now responds to price. Above fundamentals, NPPs take profits;
    // underwater, they sit on the position. That's loss aversion, and it's what
    // makes a flat 3% coin flip stop looking like a random number generator with
    // a brokerage account.
    const execPrice = resolveShareExecutionPrice(corp);
    const fundamental = corp.fundamentalSharePrice ?? execPrice;
    const priceRatio =
      execPrice > 0 && fundamental > 0 ? Math.min(Math.max(execPrice / fundamental, 0.5), 2.5) : 1;

    for (const holding of corp.shareholders ?? []) {
      if (!holding.nppId || (holding.shares ?? 0) <= 0) continue;
      if (corp.ceoId?.equals(holding.nppId)) continue; // never sweep-sell a CEO's own stake

      const personality = personalityById.get(holding.nppId.toString());
      // A risk-tolerant holder is slower to bail; a cautious one takes the gain.
      const riskMult = personality
        ? careerArchetypeModifiersContinuous(personality).riskToleranceMult
        : 1;
      const sellProbability = NPP_STOCK_SELL_BASE_PROBABILITY * priceRatio * (2 - riskMult);
      if (rng() >= sellProbability) continue;

      // Trim size varies with conviction rather than being a flat half every time.
      const sellFraction = NPP_STOCK_SELL_FRACTION * Math.min(Math.max(priceRatio, 0.6), 1.4);
      const sharesToSell = Math.floor(holding.shares * Math.min(sellFraction, 1));
      if (sharesToSell < 1) continue;

      const countryId = countryById.get(holding.nppId.toString());
      if (!countryId) continue;
      const homeRate = fxByCcy.get(COUNTRY_CURRENCY_MAP[countryId as CountryId] ?? "USD") ?? 1;

      // Proceeds credit nppInvestmentCashAnchor (the forex account), not funds.
      await nppSellShares(
        db,
        { _id: holding.nppId, countryId },
        corp._id,
        sharesToSell,
        currentTurn,
        homeRate
      );
    }
  }
}

/**
 * v3 corporation-founding sweep — the natural next step after buy/sell lets
 * NPPs accumulate capital. Bounds the candidate pool to the N wealthiest
 * NPPs (query, not a full scan) rather than checking all NPPs for "funds
 * above threshold". Sector type is picked deterministically (seeded roll
 * over CORPORATION_TYPES) — no diversification logic needed here, that's
 * organic across many independent founding events over a long run.
 */
async function foundNppCorporationsSurplus(
  db: Db,
  currentTurn: number,
  countryScope: CountryId[] | null = null
): Promise<void> {
  // Founding draws from the personal forex account (₳). Pre-filter the pool by
  // ₳ investment capital; the core enforces exact per-NPP affordability (fee is
  // FX-converted there). minFunds doubles as a rough ₳ threshold.
  const minFunds = NPP_FOUNDING_FEE * NPP_FOUNDING_FUNDS_BUFFER;
  const candidates = await db
    .collection<NPP>("npps")
    .find(
      {
        retiredAt: null,
        nppInvestmentCashAnchor: { $gte: minFunds },
        ...countryScopeFilter(countryScope),
      },
      {
        projection: {
          countryId: 1,
          party: 1,
          homeState: 1,
          personality: 1,
          nppInvestmentCashAnchor: 1,
        },
      }
    )
    .sort({ nppInvestmentCashAnchor: -1 })
    .limit(NPP_FOUNDING_CANDIDATE_POOL)
    .toArray();
  if (candidates.length === 0) return;

  const rng = makeSeededRng(`npp-found-corp:${currentTurn}${NPP_ACTION_RNG_SALT}`);
  const fxByCcy = await loadFxRatesByCurrency(db);

  for (const npp of candidates) {
    const archetype = deriveCeoArchetype(npp.personality);
    if (rng() >= NPP_FOUNDING_BASE_PROBABILITY_BY_ARCHETYPE[archetype]) continue;

    const alreadyCeo = await db
      .collection<Corporation>("corporations")
      .findOne({ ceoId: npp._id, ceoVacant: { $ne: true } }, { projection: { _id: 1 } });
    if (alreadyCeo) continue;

    const sectorType = CORPORATION_TYPES[
      Math.floor(rng() * CORPORATION_TYPES.length)
    ] as CorporationType;

    const homeRate =
      fxByCcy.get(COUNTRY_CURRENCY_MAP[(npp.countryId ?? "US") as CountryId] ?? "USD") ?? 1;
    await nppFoundCorporation(db, npp, sectorType, NPP_FOUNDING_FEE, currentTurn, homeRate);
  }
}

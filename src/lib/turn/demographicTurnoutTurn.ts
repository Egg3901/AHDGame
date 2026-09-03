import {
  getStateDemographicTurnoutCollection,
  getPartyBudgetCollection,
} from "@/lib/db/collections";
import type {
  StateDemographicTurnout,
  PartyBudget,
  Character,
  State,
  PoliticalParty,
  StatePartyOrg,
  StateRegistrationPool,
  OrgRegLedger,
  NPP,
  GameConfig,
} from "@/lib/db/types";
import { POOL_SENTINEL_PARTY_ID } from "@/lib/db/types";
import { applyDecay } from "@/lib/utils/turnoutDecay";
import {
  calculateAlignmentMultiplier,
  DOLLARS_PER_TURNOUT_POINT,
} from "@/lib/utils/demographicAlignment";
import {
  projectCharacterGeneration,
  projectNppGeneration,
  calculateTaxAmount,
} from "@/lib/utils/fundGeneration";
import { getDb } from "@/lib/mongodb";
import { ObjectId } from "mongodb";
import {
  applyBoost,
  calculateGOTVSpend,
  calculateRegistrationDriveSpend,
  calculateSuppressionSpend,
  calculateNationalGOTVBoost,
  calculateStateGOTVBoost,
  calculateCanvassingBoost,
} from "./demographicTurnoutCalculations";
import { resolveCanvassGroup } from "@/lib/demographics/countryDemographics";
import {
  calculateRegistrationDriveBoost,
  planRegistrationDriveDraw,
} from "./partyOrg/registrationDrive";
import { DEFAULT_LEGACY_COUNTRY_ID, type CountryId } from "@/lib/constants/countries";
import { loadTxThresholds, emitTxBulk } from "@/lib/financialTxLog/emit";
import { emitTreasuryTransaction } from "@/lib/treasury/emit";
import type { FinancialTxLogEntry } from "@/lib/db/types/financialTxLog";
import { isPartyTreasuryNegative, resetPartyBudgetSpending } from "@/lib/partyBudgetGuards";
import { logger } from "../observability/logger";

type StoredPartyBudget = PartyBudget & { countryId?: CountryId };

/**
 * Apply decay to all demographic modifiers in all states.
 * Called at the start of each turn.
 *
 * @param states - Optional array of states for testing. If not provided, fetches from DB.
 * @returns Array of states with decayed modifiers and updated timestamps
 */
export async function applyDecayToAllStates(
  states?: StateDemographicTurnout[]
): Promise<StateDemographicTurnout[]> {
  // For testing, accept states array; otherwise fetch from DB
  let turnoutData: StateDemographicTurnout[];
  let collection;

  if (states) {
    // Deep copy for testing to avoid mutation (JSON method preserves types correctly)
    turnoutData = JSON.parse(JSON.stringify(states)) as StateDemographicTurnout[];
  } else {
    try {
      collection = await getStateDemographicTurnoutCollection();
      turnoutData = await collection.find({}).toArray();

      if (turnoutData.length === 0) {
        logger.warn("Demographic Turnout Turn", "No state demographic data found");
        return [];
      }
    } catch (error) {
      logger.error("Demographic Turnout Turn", "Error fetching state data", error);
      throw error;
    }
  }

  const results: StateDemographicTurnout[] = [];

  for (const state of turnoutData) {
    const modifiers = state.modifiers;

    // Apply decay to all categories.
    // Iterates dynamically over whatever category keys exist in the document —
    // supports both legacy US documents (race/age/education/wealth/ideology) and
    // new country-specific documents (e.g. UK voterGroups).
    for (const category of Object.keys(modifiers)) {
      const categoryModifiers = modifiers[category] as Record<string, number>;
      if (!categoryModifiers || typeof categoryModifiers !== "object") continue;
      for (const group of Object.keys(categoryModifiers)) {
        categoryModifiers[group] = applyDecay(categoryModifiers[group]);
      }
    }

    state.lastDecayApplied = new Date();
    state.lastUpdated = new Date();

    results.push(state);
  }

  // Bulk update DB if not in test mode
  if (!states && collection && results.length > 0) {
    try {
      const ops = results.map((state) => ({
        updateOne: {
          filter: { _id: state._id },
          update: {
            $set: {
              modifiers: state.modifiers,
              lastDecayApplied: state.lastDecayApplied,
              lastUpdated: state.lastUpdated,
            },
          },
        },
      }));
      await collection.bulkWrite(ops);
    } catch (error) {
      logger.error("Demographic Turnout Turn", "Error updating state data", error);
      throw error;
    }
  }

  return results;
}

// Re-export for backwards compatibility
export { LAYER1_DEMOGRAPHICS } from "@/lib/utils/demographicAlignment";

interface PartyPosition {
  economic: number;
  social: number;
}

interface ProcessGOTVResult {
  turnout: StateDemographicTurnout[];
  budgets: PartyBudget[];
}

/** Pre-fetched data for revenue calculation (avoids N+1 queries) */
interface RevenueContext {
  partyMap: Map<string, PoliticalParty>;
  statePartyOrgMap: Map<string, StatePartyOrg>;
  statePopMap: Map<string, number>;
  // Raw state GDP (undefined when absent → country-average scalar 1.0, matching
  // the turn processor; coalescing to 0 would wrongly clamp to the 0.9 floor).
  stateGdpMap: Map<string, number | undefined>;
  // NPPs only generate/are taxed when the economy is enabled (mirrors
  // processNppFundGeneration); otherwise they contribute $0 to revenue, so GOTV
  // never budgets against NPP income the treasury will not receive.
  nppEconomyEnabled: boolean;
  charactersByParty: Map<string, Character[]>;
  charactersByPartyState: Map<string, Character[]>;
  nppsByParty: Map<string, NPP[]>;
  nppsByPartyState: Map<string, NPP[]>;
}

interface BudgetCountryResolution {
  countryId: CountryId;
  canBackfill: boolean;
}

/**
 * Calculate the expected hourly revenue for a national or state party.
 * Revenue = sum of tax income from all members' fund generation.
 * Uses pre-fetched data to avoid per-budget DB queries.
 */
function calculatePartyRevenueFromContext(
  partyId: string,
  scope: "national" | "state",
  ctx: RevenueContext,
  countryId?: CountryId,
  stateId?: string
): number {
  if (scope === "national") {
    if (!countryId) return 0;
    const party = ctx.partyMap.get(`${countryId}:${partyId}`);
    const nationalTaxRate = party?.nationalTaxRate ?? 0;
    if (nationalTaxRate <= 0) return 0;

    const partyKey = `${countryId}:${partyId}`;
    const characters = ctx.charactersByParty.get(partyKey) ?? [];
    const npps = ctx.nppsByParty.get(partyKey) ?? [];

    let revenue = 0;
    for (const member of characters) {
      const pop = ctx.statePopMap.get(member.homeState) ?? 0;
      const totalFundRate = projectCharacterGeneration({
        population: pop,
        donorBaseLevel: member.donorBaseLevel,
        currentOffice: member.currentOffice,
        stateGdpMillions: ctx.stateGdpMap.get(member.homeState),
        countryId,
        politicalInfluence: member.politicalInfluence ?? 0,
      });
      revenue += calculateTaxAmount(totalFundRate, nationalTaxRate);
    }
    for (const npp of npps) {
      const pop = ctx.statePopMap.get(npp.homeState) ?? 0;
      const totalFundRate = projectNppGeneration({
        population: pop,
        donorBaseLevel: npp.donorBaseLevel ?? 0,
        currentFundsLocal: npp.funds ?? 0,
        nppEconomyEnabled: ctx.nppEconomyEnabled,
      });
      revenue += calculateTaxAmount(totalFundRate, nationalTaxRate);
    }
    return revenue;
  } else {
    if (!stateId) return 0;
    const statePartyKey = `${stateId}_${partyId}`;
    const stateParty = ctx.statePartyOrgMap.get(statePartyKey);
    const stateTaxRate = stateParty?.stateTaxRate ?? 0;
    if (stateTaxRate <= 0) return 0;

    const pop = ctx.statePopMap.get(stateId) ?? 0;
    if (pop === 0) return 0;

    const key = `${countryId ?? DEFAULT_LEGACY_COUNTRY_ID}:${partyId}_${stateId}`;
    const characters = ctx.charactersByPartyState.get(key) ?? [];
    const npps = ctx.nppsByPartyState.get(key) ?? [];

    let revenue = 0;
    for (const member of characters) {
      const totalFundRate = projectCharacterGeneration({
        population: pop,
        donorBaseLevel: member.donorBaseLevel,
        currentOffice: member.currentOffice,
        stateGdpMillions: ctx.stateGdpMap.get(stateId),
        countryId,
        politicalInfluence: member.politicalInfluence ?? 0,
      });
      revenue += calculateTaxAmount(totalFundRate, stateTaxRate);
    }
    for (const npp of npps) {
      const totalFundRate = projectNppGeneration({
        population: pop,
        donorBaseLevel: npp.donorBaseLevel ?? 0,
        currentFundsLocal: npp.funds ?? 0,
        nppEconomyEnabled: ctx.nppEconomyEnabled,
      });
      revenue += calculateTaxAmount(totalFundRate, stateTaxRate);
    }
    return revenue;
  }
}

/**
 * Process party GOTV spending for all active party budgets.
 * Boosts demographics within 2 points of party position.
 *
 * gotvBudgetPercent (0-25) is the percentage of hourly revenue allocated to GOTV.
 * The actual dollar amount spent each turn is computed from this percentage.
 *
 * @param budgets - Optional array of budgets for testing. If not provided, fetches active budgets from DB.
 * @param turnoutData - Optional array of turnout data for testing. If not provided, fetches from DB.
 * @param partyPosition - Optional party position for testing. If not provided, fetches from DB.
 * @param revenueOverride - Optional revenue for testing. If provided, skips DB revenue calculation.
 * @param preloadedStateMap - Optional pre-loaded state map to avoid duplicate DB query.
 * @param statePartyOrgOverrides - Optional state party orgs for testing (treasury source for state budgets). If not provided with `budgets`, state-scope treasury defaults to 0.
 * @param politicalPartyOverrides - Optional political parties for testing (treasury source for national budgets). If not provided with `budgets`, national-scope treasury defaults to 0.
 * @returns Updated turnout data and budgets
 */
export async function processPartyGOTV(
  budgets?: PartyBudget[],
  turnoutData?: StateDemographicTurnout[],
  partyPosition?: PartyPosition,
  revenueOverride?: number,
  preloadedStateMap?: Map<string, State>,
  statePartyOrgOverrides?: StatePartyOrg[],
  politicalPartyOverrides?: PoliticalParty[],
  turn?: number
): Promise<ProcessGOTVResult> {
  let budgetCollection;
  let turnoutCollection;

  // For testing, accept arrays; otherwise fetch from DB
  let partyBudgets: StoredPartyBudget[];
  let stateTurnout: StateDemographicTurnout[];

  if (budgets) {
    partyBudgets = budgets;
  } else {
    try {
      budgetCollection = await getPartyBudgetCollection();
      // Fetch all rows so country-scoped replacements can suppress legacy rows
      // that still carry old spending values during the compatibility window.
      partyBudgets = (await budgetCollection.find({}).toArray()) as StoredPartyBudget[];
    } catch (error) {
      logger.error("Demographic Turnout Turn", "Error fetching party budgets", error);
      throw error;
    }
  }

  if (turnoutData) {
    // Deep copy for testing to avoid mutation (JSON method preserves types correctly)
    stateTurnout = JSON.parse(JSON.stringify(turnoutData)) as StateDemographicTurnout[];
  } else {
    try {
      turnoutCollection = await getStateDemographicTurnoutCollection();
      stateTurnout = await turnoutCollection.find({}).toArray();
    } catch (error) {
      logger.error("Demographic Turnout Turn", "Error fetching turnout data", error);
      throw error;
    }
  }

  // Load treasury sources: statePartyOrg for state budgets, politicalParty for national.
  const db = budgets ? null : await getDb();
  const now = new Date();
  const thresholds = db ? await loadTxThresholds(db) : null;
  const txGotvEntries: Omit<FinancialTxLogEntry, "_id" | "expiresAt" | "flagged">[] = [];
  const statePartyOrgMap = new Map<string, StatePartyOrg>();
  const nationalPartyMap = new Map<string, PoliticalParty>();
  const statePartyTreasuryDeductions = new Map<string, number>();
  const nationalPartyTreasuryDeductions = new Map<string, number>();
  const nationalPartyGotvDeductions = new Map<string, number>();
  const nationalPartySuppressionDeductions = new Map<string, number>();
  const nationalPartyRegistrationDeductions = new Map<string, number>();
  // Registration-drive (suggestion #81) staged writes, committed after the loop.
  const registrationPoolMap = new Map<string, StateRegistrationPool>(); // `${countryId}:${stateId}`
  const statePartyRowsByCountryParty = new Map<string, StatePartyOrg[]>(); // `${countryId}:${partyId}`
  const registrationRegDeltas = new Map<string, number>(); // statePartyOrg._id -> +reg pp
  const registrationPoolUnregDrawn = new Map<string, number>(); // pool._id -> pp drawn from unregistered
  const registrationPoolIndepDrawn = new Map<string, number>(); // pool._id -> pp drawn from independent
  const registrationLedgerRows: Omit<OrgRegLedger, "_id">[] = [];
  const budgetsToReset: PartyBudget[] = [];
  const budgetCountryBackfills = new Map<string, CountryId>();

  // Test mode: caller can inject treasury sources directly.
  if (statePartyOrgOverrides) {
    for (const spo of statePartyOrgOverrides) {
      statePartyOrgMap.set(spo._id, spo);
    }
  }
  if (politicalPartyOverrides) {
    for (const p of politicalPartyOverrides) {
      nationalPartyMap.set(`${p.countryId ?? "US"}:${p.sequentialId}`, p);
    }
  }

  // Pre-fetch all data needed for revenue calculation (avoids N+1 queries per budget)
  let revenueCtx: RevenueContext | null = null;
  const uniqueCountryByPartyId = new Map<string, CountryId | null>();

  if (db) {
    // Use pre-loaded states if available, otherwise fetch from DB
    const statesPromise = preloadedStateMap
      ? Promise.resolve<
          Array<{
            _id: string;
            population: number;
            gdp?: number;
            votingEligiblePopulation?: number;
          }>
        >(
          [...preloadedStateMap.values()].map((s) => ({
            _id: s._id,
            population: s.population,
            gdp: s.gdp,
            votingEligiblePopulation: s.votingEligiblePopulation,
          }))
        )
      : db
          .collection<State>("states")
          .find({}, { projection: { _id: 1, population: 1, gdp: 1, votingEligiblePopulation: 1 } })
          .toArray();

    const [statePartyOrgs, parties, allCharacters, allNPPs, allStates] = await Promise.all([
      db.collection<StatePartyOrg>("statePartyOrg").find({}).toArray(),
      db.collection<PoliticalParty>("politicalParties").find({}).toArray(),
      db
        .collection<Character>("characters")
        .find(
          {},
          {
            projection: {
              party: 1,
              homeState: 1,
              donorBaseLevel: 1,
              currentOffice: 1,
              countryId: 1,
              politicalInfluence: 1,
            },
          }
        )
        .toArray(),
      db
        .collection<NPP>("npps")
        .find(
          { retiredAt: null },
          {
            projection: {
              party: 1,
              homeState: 1,
              currentOffice: 1,
              countryId: 1,
              funds: 1,
              donorBaseLevel: 1,
            },
          }
        )
        .toArray(),
      statesPromise,
    ]);
    const gameConfig = await db.collection<GameConfig>("gameConfig").findOne({ _id: "default" });
    const nppEconomyEnabled = gameConfig?.nppEconomyEnabled !== false;
    for (const spo of statePartyOrgs) {
      statePartyOrgMap.set(spo._id, spo);
    }
    // Use composite keys to avoid cross-country sequential ID collisions
    for (const p of parties) {
      nationalPartyMap.set(`${p.countryId ?? "US"}:${p.sequentialId}`, p);
      const partyId = String(p.sequentialId);
      const existingCountry = uniqueCountryByPartyId.get(partyId);
      if (existingCountry === undefined) {
        uniqueCountryByPartyId.set(partyId, p.countryId ?? DEFAULT_LEGACY_COUNTRY_ID);
      } else if (existingCountry !== (p.countryId ?? DEFAULT_LEGACY_COUNTRY_ID)) {
        uniqueCountryByPartyId.set(partyId, null);
      }
    }

    // Build grouped lookups for revenue calculation
    const charactersByParty = new Map<string, Character[]>();
    const charactersByPartyState = new Map<string, Character[]>();
    for (const c of allCharacters) {
      const countryKey = `${c.countryId ?? DEFAULT_LEGACY_COUNTRY_ID}:${c.party}`;
      const pList = charactersByParty.get(countryKey) ?? [];
      pList.push(c);
      charactersByParty.set(countryKey, pList);
      const psKey = `${c.countryId ?? DEFAULT_LEGACY_COUNTRY_ID}:${c.party}_${c.homeState}`;
      const psList = charactersByPartyState.get(psKey) ?? [];
      psList.push(c);
      charactersByPartyState.set(psKey, psList);
    }
    const nppsByParty = new Map<string, NPP[]>();
    const nppsByPartyState = new Map<string, NPP[]>();
    for (const n of allNPPs) {
      const countryKey = `${n.countryId ?? DEFAULT_LEGACY_COUNTRY_ID}:${n.party}`;
      const pList = nppsByParty.get(countryKey) ?? [];
      pList.push(n);
      nppsByParty.set(countryKey, pList);
      const psKey = `${n.countryId ?? DEFAULT_LEGACY_COUNTRY_ID}:${n.party}_${n.homeState}`;
      const psList = nppsByPartyState.get(psKey) ?? [];
      psList.push(n);
      nppsByPartyState.set(psKey, psList);
    }

    revenueCtx = {
      partyMap: nationalPartyMap,
      statePartyOrgMap,
      // Donor base = adults: use the voting-age population (P1b-1c), falling back
      // to total on unseeded worlds. Fund generation scales with this base.
      statePopMap: new Map(
        allStates.map((s) => [s._id, s.votingEligiblePopulation ?? s.population])
      ),
      stateGdpMap: new Map(allStates.map((s) => [s._id, s.gdp])),
      nppEconomyEnabled,
      charactersByParty,
      charactersByPartyState,
      nppsByParty,
      nppsByPartyState,
    };

    const dedupedBudgets = new Map<string, StoredPartyBudget>();
    for (const budget of partyBudgets) {
      const budgetCountry = resolveBudgetCountry(budget, statePartyOrgMap, uniqueCountryByPartyId);
      const key =
        budget.scope === "state"
          ? `${budgetCountry.countryId}:${budget.partyId}:${budget.scope}:${budget.stateId}`
          : `${budgetCountry.countryId}:${budget.partyId}:${budget.scope}`;
      const existingBudget = dedupedBudgets.get(key);
      if (!existingBudget || (!existingBudget.countryId && !!budget.countryId)) {
        dedupedBudgets.set(key, budget);
      }
    }
    partyBudgets = [...dedupedBudgets.values()];

    // Registration-drive (suggestion #81): only pay for the extra pool read +
    // party→states index when at least one budget actually funds a drive. The
    // feature is opt-in (default 0%), so unused worlds keep the prior query set.
    const anyRegistrationBudget = partyBudgets.some((b) => (b.registrationBudgetPercent ?? 0) > 0);
    if (anyRegistrationBudget) {
      const pools = await db
        .collection<StateRegistrationPool>("stateRegistrationPool")
        .find({})
        .toArray();
      for (const pool of pools) {
        registrationPoolMap.set(`${pool.countryId}:${pool.stateId}`, pool);
      }
      for (const spo of statePartyOrgs) {
        const key = `${spo.countryId}:${spo.partyId}`;
        const list = statePartyRowsByCountryParty.get(key);
        if (list) list.push(spo);
        else statePartyRowsByCountryParty.set(key, [spo]);
      }
    }
  }

  for (const budget of partyBudgets) {
    const budgetCountry = resolveBudgetCountry(budget, statePartyOrgMap, uniqueCountryByPartyId);
    const budgetCountryId = budgetCountry.countryId;
    if (
      (budget.gotvBudgetPercent ?? 0) <= 0 &&
      (budget.gotvBudgetPerTurn ?? 0) <= 0 &&
      (budget.suppressionBudgetPercent ?? 0) <= 0 &&
      (budget.registrationBudgetPercent ?? 0) <= 0
    ) {
      continue;
    }

    const revenue =
      revenueOverride ??
      (revenueCtx
        ? calculatePartyRevenueFromContext(
            budget.partyId,
            budget.scope,
            revenueCtx,
            budgetCountryId,
            budget.scope === "state" ? budget.stateId : undefined
          )
        : 0);

    // Get party position (use param for testing, otherwise use pre-fetched data)
    // PartyBudget has countryId post-migration
    const partyKey = `${budgetCountryId}:${budget.partyId}`;
    const position =
      partyPosition ??
      (revenueCtx
        ? getPartyPositionFromMap(partyKey, revenueCtx.partyMap)
        : await getPartyPosition(budget.partyId, budgetCountryId));

    if (!budget.countryId && budgetCountry.canBackfill) {
      budgetCountryBackfills.set(budget._id.toString(), budgetCountryId);
    }

    // Source of truth: statePartyOrg.treasury (state) or politicalParty.treasury (national).
    // National deductions must be keyed by `${countryId}:${partyId}` — bare partyId
    // collides across countries (e.g. US DEM seqId=1 and UK LAB seqId=1).
    let availableTreasury = 0;
    let treasuryKey = "";
    if (budget.scope === "state") {
      treasuryKey = `${budget.stateId}_${budget.partyId}`;
      const stateParty = statePartyOrgMap.get(treasuryKey);
      availableTreasury =
        (stateParty?.treasury ?? 0) - (statePartyTreasuryDeductions.get(treasuryKey) ?? 0);
    } else {
      treasuryKey = partyKey;
      const nationalParty = nationalPartyMap.get(partyKey);
      availableTreasury =
        (nationalParty?.treasury ?? 0) - (nationalPartyTreasuryDeductions.get(treasuryKey) ?? 0);
    }

    if (isPartyTreasuryNegative(availableTreasury)) {
      budget.gotvBudgetPerTurn = 0;
      budget.gotvBudgetPercent = 0;
      budget.suppressionBudgetPercent = 0;
      budget.orgBuildingPercent = 0;
      budget.registrationBudgetPercent = 0;
      budgetsToReset.push(budget);
      continue;
    }

    let totalSpend = 0;

    // ── GOTV (positive turnout boost) ──────────────────────────────────
    const gotvSpend = calculateGOTVSpend(
      revenue,
      budget.gotvBudgetPercent ?? 0,
      budget.gotvBudgetPerTurn
    );

    if (gotvSpend > 0 && availableTreasury >= gotvSpend) {
      const targetCategory = budget.gotvTargetCategory;
      const targetGroup = budget.gotvTargetGroup;

      if (targetCategory && targetGroup) {
        // Country-aware lean lookup: non-US parties target voter-group
        // categories (e.g. UK uk_voterGroups) absent from the US-only
        // LAYER1 table, which used to collapse their alignment to the 0.1
        // fallback (ticket #1265).
        const lean = resolveCanvassGroup(budgetCountryId, targetCategory, targetGroup);
        const alignMult = lean
          ? calculateAlignmentMultiplier(
              position.economic,
              position.social,
              lean.economicLean,
              lean.socialLean
            )
          : 0.1;

        if (budget.scope === "national") {
          // National: divide spend across this country's regions only. The
          // collection holds every country's docs, so the unfiltered length
          // diluted non-US parties (UK: 12 regions split ~127 ways) and
          // leaked boosts into foreign countries (ticket #1265).
          const inScopeTurnout = stateTurnout.filter((s) =>
            isTurnoutDocInCountry(s, budgetCountryId)
          );
          const boost = calculateNationalGOTVBoost(
            gotvSpend,
            inScopeTurnout.length,
            DOLLARS_PER_TURNOUT_POINT,
            alignMult
          );
          for (const state of inScopeTurnout) {
            applyBoost(state, { category: targetCategory, group: targetGroup }, boost);
            state.lastUpdated = new Date();
          }
        } else {
          // State: full spend in one state
          const state = stateTurnout.find((s) => s._id === budget.stateId);
          if (state) {
            const boost = calculateStateGOTVBoost(gotvSpend, DOLLARS_PER_TURNOUT_POINT, alignMult);
            applyBoost(state, { category: targetCategory, group: targetGroup }, boost);
            state.lastUpdated = new Date();
          }
        }
        totalSpend += gotvSpend;
        availableTreasury -= gotvSpend;
        if (budget.scope === "national") {
          nationalPartyGotvDeductions.set(
            treasuryKey,
            (nationalPartyGotvDeductions.get(treasuryKey) ?? 0) + gotvSpend
          );
        }
      }
      // If no target group selected, GOTV does nothing (group selection required)
    }

    // ── Voter Suppression (negative turnout modifier) ──────────────────
    const suppressionPercent = budget.suppressionBudgetPercent ?? 0;

    if (suppressionPercent > 0) {
      const suppressionSpend = calculateSuppressionSpend(revenue, suppressionPercent);
      const supCategory = budget.suppressionTargetCategory;
      const supGroup = budget.suppressionTargetGroup;

      if (
        suppressionSpend > 0 &&
        availableTreasury >= suppressionSpend &&
        supCategory &&
        supGroup
      ) {
        // Suppression targets a specific demographic with a negative boost
        // Alignment multiplier is inverted: further groups are EASIER to suppress
        const supLean = resolveCanvassGroup(budgetCountryId, supCategory, supGroup);
        const alignMult = supLean
          ? calculateAlignmentMultiplier(
              position.economic,
              position.social,
              supLean.economicLean,
              supLean.socialLean
            )
          : 0.5;

        if (budget.scope === "national") {
          const inScopeTurnout = stateTurnout.filter((s) =>
            isTurnoutDocInCountry(s, budgetCountryId)
          );
          const negBoost = calculateNationalGOTVBoost(
            suppressionSpend,
            inScopeTurnout.length,
            DOLLARS_PER_TURNOUT_POINT,
            alignMult
          );
          for (const state of inScopeTurnout) {
            applyBoost(state, { category: supCategory, group: supGroup }, -negBoost);
            state.lastUpdated = new Date();
          }
        } else {
          const state = stateTurnout.find((s) => s._id === budget.stateId);
          if (state) {
            const negBoost = calculateStateGOTVBoost(
              suppressionSpend,
              DOLLARS_PER_TURNOUT_POINT,
              alignMult
            );
            applyBoost(state, { category: supCategory, group: supGroup }, -negBoost);
            state.lastUpdated = new Date();
          }
        }
        totalSpend += suppressionSpend;
        availableTreasury -= suppressionSpend;
        if (budget.scope === "national") {
          nationalPartySuppressionDeductions.set(
            treasuryKey,
            (nationalPartySuppressionDeductions.get(treasuryKey) ?? 0) + suppressionSpend
          );
        }
      }
    }

    // ── Voter Registration Drive (suggestion #81) ─────────────────────
    // Converts a % of revenue into a small, bounded per-state registration
    // boost drawn from the state's non-party pool (unregistered → independent),
    // spending from treasury exactly like GOTV. Guarded on `db` because it needs
    // the pool rows; test-mode callers that inject budgets without a db skip it.
    const registrationPercent = budget.registrationBudgetPercent ?? 0;
    if (registrationPercent > 0 && db) {
      const registrationSpend = calculateRegistrationDriveSpend(revenue, registrationPercent);
      if (registrationSpend > 0 && availableTreasury >= registrationSpend) {
        // Resolve the target state-party rows (+ their pools) for this scope.
        const targets: { spo: StatePartyOrg; pool: StateRegistrationPool }[] = [];
        if (budget.scope === "national") {
          const rows =
            statePartyRowsByCountryParty.get(`${budgetCountryId}:${budget.partyId}`) ?? [];
          for (const spo of rows) {
            const pool = registrationPoolMap.get(`${spo.countryId}:${spo.stateId}`);
            if (pool) targets.push({ spo, pool });
          }
        } else {
          const spo = statePartyOrgMap.get(`${budget.stateId}_${budget.partyId}`);
          const pool = spo ? registrationPoolMap.get(`${spo.countryId}:${spo.stateId}`) : undefined;
          if (spo && pool) targets.push({ spo, pool });
        }

        if (targets.length > 0) {
          const perStateSpend =
            budget.scope === "national" ? registrationSpend / targets.length : registrationSpend;
          const desiredBoost = calculateRegistrationDriveBoost(
            perStateSpend,
            DOLLARS_PER_TURNOUT_POINT
          );
          let anyApplied = false;
          for (const { spo, pool } of targets) {
            const unregDrawn = registrationPoolUnregDrawn.get(pool._id) ?? 0;
            const indepDrawn = registrationPoolIndepDrawn.get(pool._id) ?? 0;
            const draw = planRegistrationDriveDraw(
              desiredBoost,
              pool.unregistered - unregDrawn,
              pool.independent - indepDrawn
            );
            if (draw.applied <= 0) continue;
            anyApplied = true;

            const cumulativeReg = (registrationRegDeltas.get(spo._id) ?? 0) + draw.applied;
            registrationRegDeltas.set(spo._id, cumulativeReg);
            registrationPoolUnregDrawn.set(pool._id, unregDrawn + draw.fromUnregistered);
            registrationPoolIndepDrawn.set(pool._id, indepDrawn + draw.fromIndependent);

            // Ledger: reg gain + matching pool draws (keeps the 100% invariant).
            registrationLedgerRows.push({
              turn: turn ?? 0,
              countryId: budgetCountryId,
              stateId: spo.stateId,
              partyId: budget.partyId,
              metric: "reg",
              delta: draw.applied,
              value: (spo.registration ?? 0) + cumulativeReg,
              source: "passive",
              actorId: null,
              createdAt: now,
              note: "passive:registrationDrive",
            });
            if (draw.fromUnregistered > 0) {
              registrationLedgerRows.push({
                turn: turn ?? 0,
                countryId: budgetCountryId,
                stateId: spo.stateId,
                partyId: POOL_SENTINEL_PARTY_ID,
                metric: "unregistered",
                delta: -draw.fromUnregistered,
                value: pool.unregistered - (unregDrawn + draw.fromUnregistered),
                source: "passive",
                actorId: null,
                createdAt: now,
                note: "passive:registrationDrive",
              });
            }
            if (draw.fromIndependent > 0) {
              registrationLedgerRows.push({
                turn: turn ?? 0,
                countryId: budgetCountryId,
                stateId: spo.stateId,
                partyId: POOL_SENTINEL_PARTY_ID,
                metric: "independent",
                delta: -draw.fromIndependent,
                value: pool.independent - (indepDrawn + draw.fromIndependent),
                source: "passive",
                actorId: null,
                createdAt: now,
                note: "passive:registrationDrive",
              });
            }
          }

          if (anyApplied) {
            totalSpend += registrationSpend;
            availableTreasury -= registrationSpend;
            if (budget.scope === "national") {
              nationalPartyRegistrationDeductions.set(
                treasuryKey,
                (nationalPartyRegistrationDeductions.get(treasuryKey) ?? 0) + registrationSpend
              );
            }
          }
        }
      }
    }

    // ── Organization Building — REMOVED ─────────────────────────────────
    // The legacy passive treasury-driven Org Building stream was retired
    // when the PS-driven `/build-org` route shipped. State chairs now
    // grow Org by spending Political Strength, not by setting a budget %.
    // The `orgBuildingPercent` field on `partyBudget` is no longer read
    // by the turn pipeline; existing rows are inert. (Field kept on the
    // type for backwards-compat with stored rows; eligible for removal
    // in a future schema cleanup.)

    // Track treasury deductions to apply at the end
    if (totalSpend > 0) {
      const partyName = nationalPartyMap.get(partyKey)?.name ?? `Party ${budget.partyId}`;
      txGotvEntries.push({
        type: "party_gotv_spend",
        turn: turn ?? 0,
        createdAt: now,
        subjectType: "party",
        subjectName: partyName,
        amount: -totalSpend,
        currencyCode: "USD",
        meta: {
          scope: budget.scope,
          stateId: "stateId" in budget ? budget.stateId : null,
          countryId: budgetCountryId,
        },
      });
      if (budget.scope === "state") {
        statePartyTreasuryDeductions.set(
          treasuryKey,
          (statePartyTreasuryDeductions.get(treasuryKey) ?? 0) + totalSpend
        );
      } else {
        nationalPartyTreasuryDeductions.set(
          treasuryKey,
          (nationalPartyTreasuryDeductions.get(treasuryKey) ?? 0) + totalSpend
        );
      }
    }
  }

  // Apply treasury deductions to the correct collections
  if (db && statePartyTreasuryDeductions.size > 0) {
    const ops = [...statePartyTreasuryDeductions.entries()].map(([key, amount]) => ({
      updateOne: {
        filter: { _id: key },
        update: { $inc: { treasury: -amount }, $set: { updatedAt: new Date() } },
      },
    }));
    await db.collection<StatePartyOrg>("statePartyOrg").bulkWrite(ops);

    for (const [key, amount] of statePartyTreasuryDeductions.entries()) {
      const sp = statePartyOrgMap.get(key);
      if (!sp) continue;
      await emitTreasuryTransaction({
        db,
        countryId: sp.countryId ?? "US",
        partyId: sp.partyId,
        holderType: "state_party",
        holderId: key,
        category: "gotv",
        direction: "debit",
        amount,
        memo: "GOTV operations",
        turn: turn ?? 0,
        now,
      });
    }
  }
  if (db && nationalPartyTreasuryDeductions.size > 0) {
    // Keys are `${countryId}:${sequentialId}` — split to address the right party.
    const ops = [...nationalPartyTreasuryDeductions.entries()].map(([key, amount]) => {
      const [countryId, seqStr] = key.split(":");
      return {
        updateOne: {
          filter: { countryId: countryId as CountryId, sequentialId: Number(seqStr) },
          update: { $inc: { treasury: -amount }, $set: { updatedAt: new Date() } },
        },
      };
    });
    await db.collection<PoliticalParty>("politicalParties").bulkWrite(ops);

    for (const [key, amount] of nationalPartyGotvDeductions.entries()) {
      const [cidRaw, seqStr] = key.split(":");
      await emitTreasuryTransaction({
        db,
        countryId: cidRaw as CountryId,
        partyId: seqStr,
        holderType: "party",
        holderId: seqStr,
        category: "gotv",
        direction: "debit",
        amount,
        memo: "GOTV operations",
        turn: turn ?? 0,
        now,
      });
    }

    for (const [key, amount] of nationalPartySuppressionDeductions.entries()) {
      const [cidRaw, seqStr] = key.split(":");
      await emitTreasuryTransaction({
        db,
        countryId: cidRaw as CountryId,
        partyId: seqStr,
        holderType: "party",
        holderId: seqStr,
        category: "suppression",
        direction: "debit",
        amount,
        memo: "Suppression operations",
        turn: turn ?? 0,
        now,
      });
    }

    for (const [key, amount] of nationalPartyRegistrationDeductions.entries()) {
      const [cidRaw, seqStr] = key.split(":");
      await emitTreasuryTransaction({
        db,
        countryId: cidRaw as CountryId,
        partyId: seqStr,
        holderType: "party",
        holderId: seqStr,
        category: "operations",
        direction: "debit",
        amount,
        memo: "Voter registration drive",
        turn: turn ?? 0,
        now,
      });
    }
  }

  if (db && budgetCountryBackfills.size > 0) {
    await db.collection<StoredPartyBudget>("partyBudget").bulkWrite(
      [...budgetCountryBackfills.entries()].map(([budgetId, countryId]) => ({
        updateOne: {
          filter: { _id: new ObjectId(budgetId), countryId: { $exists: false } },
          update: { $set: { countryId, updatedAt: now } },
        },
      }))
    );
  }

  if (db && budgetsToReset.length > 0) {
    const uniqueBudgetRefs = new Map<string, PartyBudget>();
    for (const budget of budgetsToReset) {
      const budgetCountryId = resolveBudgetCountry(
        budget,
        statePartyOrgMap,
        uniqueCountryByPartyId
      ).countryId;
      const key =
        budget.scope === "state"
          ? `${budgetCountryId}:${budget.partyId}:${budget.scope}:${budget.stateId}`
          : `${budgetCountryId}:${budget.partyId}:${budget.scope}`;
      uniqueBudgetRefs.set(key, {
        ...budget,
        countryId: budgetCountryId,
      } as PartyBudget);
    }

    await Promise.all(
      [...uniqueBudgetRefs.values()].map((budget) =>
        resetPartyBudgetSpending(
          db,
          budget.scope === "state"
            ? {
                countryId: budget.countryId,
                partyId: budget.partyId,
                scope: "state",
                stateId: budget.stateId,
              }
            : {
                countryId: budget.countryId,
                partyId: budget.partyId,
                scope: "national",
              },
          now
        )
      )
    );
  }

  if (db && thresholds && txGotvEntries.length > 0) {
    void emitTxBulk(db, txGotvEntries, thresholds);
  }

  // Commit registration-drive writes (suggestion #81): reg deltas on state-party
  // rows, matching pool draws, and the audit ledger. Uses $inc deltas so
  // multiple parties in the same state compose without lost updates, and so this
  // phase composes with the later regDriftDecay phase in the same turn.
  if (db && registrationRegDeltas.size > 0) {
    await db.collection<StatePartyOrg>("statePartyOrg").bulkWrite(
      [...registrationRegDeltas.entries()].map(([rowId, delta]) => ({
        updateOne: {
          filter: { _id: rowId },
          update: { $inc: { registration: delta }, $set: { updatedAt: now } },
        },
      }))
    );
  }
  if (db && (registrationPoolUnregDrawn.size > 0 || registrationPoolIndepDrawn.size > 0)) {
    const poolIds = new Set<string>([
      ...registrationPoolUnregDrawn.keys(),
      ...registrationPoolIndepDrawn.keys(),
    ]);
    await db.collection<StateRegistrationPool>("stateRegistrationPool").bulkWrite(
      [...poolIds].map((poolId) => ({
        updateOne: {
          filter: { _id: poolId },
          update: {
            $inc: {
              unregistered: -(registrationPoolUnregDrawn.get(poolId) ?? 0),
              independent: -(registrationPoolIndepDrawn.get(poolId) ?? 0),
            },
            $set: { lastUpdatedTurn: turn ?? 0, updatedAt: now },
          },
        },
      }))
    );
  }
  if (db && registrationLedgerRows.length > 0) {
    await db
      .collection<OrgRegLedger>("orgRegLedger")
      .insertMany(registrationLedgerRows.map((r) => ({ ...r }) as OrgRegLedger));
  }

  // (Legacy passive Org Building application block removed — Org growth
  // is now driven by the PS-spend `/build-org` route, applied per-click
  // at request time. Decay when not investing remains in `partyOrgTurn`.)

  // Save turnout changes
  if (!turnoutData && turnoutCollection && stateTurnout.length > 0) {
    try {
      const ops = stateTurnout.map((state) => ({
        updateOne: {
          filter: { _id: state._id },
          update: { $set: { modifiers: state.modifiers, lastUpdated: state.lastUpdated } },
        },
      }));
      await turnoutCollection.bulkWrite(ops);
    } catch (error) {
      logger.error("Demographic Turnout Turn", "Error updating turnout data", error);
      throw error;
    }
  }

  return { turnout: stateTurnout, budgets: partyBudgets as PartyBudget[] };
}

/**
 * Whether a turnout doc belongs to a budget's country. Legacy docs predate
 * country scoping (e.g. DC carries no countryId) and belong to the US.
 */
function isTurnoutDocInCountry(doc: StateDemographicTurnout, countryId: CountryId): boolean {
  return (doc.countryId ?? DEFAULT_LEGACY_COUNTRY_ID) === countryId;
}

function resolveBudgetCountry(
  budget: StoredPartyBudget,
  statePartyOrgMap: Map<string, StatePartyOrg>,
  uniqueCountryByPartyId: Map<string, CountryId | null>
): BudgetCountryResolution {
  if (budget.countryId) {
    return { countryId: budget.countryId, canBackfill: false };
  }

  if (budget.scope === "state") {
    const statePartyCountryId = statePartyOrgMap.get(
      `${budget.stateId}_${budget.partyId}`
    )?.countryId;
    if (statePartyCountryId) {
      return { countryId: statePartyCountryId, canBackfill: true };
    }
  }

  const uniqueCountryId = uniqueCountryByPartyId.get(budget.partyId);
  if (uniqueCountryId) {
    return { countryId: uniqueCountryId, canBackfill: true };
  }

  return { countryId: DEFAULT_LEGACY_COUNTRY_ID, canBackfill: false };
}

/**
 * Get party position from database.
 * Reads economicPosition / socialPosition from the politicalParties collection.
 * StatePartyOrg does not store its own positions, so national party positions always apply.
 */
async function getPartyPosition(
  partyId: string,
  countryId: CountryId = DEFAULT_LEGACY_COUNTRY_ID
): Promise<PartyPosition> {
  const db = await getDb();
  // Parties are uniquely identified by (countryId, sequentialId).
  const party = await db
    .collection<PoliticalParty>("politicalParties")
    .findOne({ sequentialId: Number(partyId), countryId });
  if (!party) return { economic: 0, social: 0 };
  return { economic: party.economicPosition, social: party.socialPosition };
}

/** Get party position from pre-fetched party map (no DB query) */
function getPartyPositionFromMap(
  partyId: string,
  partyMap: Map<string, PoliticalParty>
): PartyPosition {
  const party = partyMap.get(partyId);
  if (!party) return { economic: 0, social: 0 };
  return { economic: party.economicPosition, social: party.socialPosition };
}

interface CanvassingAction {
  characterId: ObjectId;
  stateId: string;
  demographic: { category: string; group: string };
  characterPosition: { economic: number; social: number };
  costFunds: number;
  costActions: number;
  isActiveCampaignSeason: boolean;
}

/**
 * Process player canvassing actions.
 * Applies boosts scaled by alignment and campaign season.
 *
 * @param actions - Optional array of canvassing actions for testing. If not provided, fetches from action queue.
 * @param turnoutData - Optional array of turnout data for testing. If not provided, fetches from DB.
 * @returns Updated turnout data
 */
export async function processPlayerCanvassing(
  actions?: CanvassingAction[],
  turnoutData?: StateDemographicTurnout[]
): Promise<StateDemographicTurnout[]> {
  let turnoutCollection;

  // For testing, accept arrays; otherwise fetch from DB
  let stateTurnout: StateDemographicTurnout[];

  if (turnoutData) {
    // Deep copy for testing to avoid mutation (JSON method preserves types correctly)
    stateTurnout = JSON.parse(JSON.stringify(turnoutData)) as StateDemographicTurnout[];
  } else {
    try {
      turnoutCollection = await getStateDemographicTurnoutCollection();
      stateTurnout = await turnoutCollection.find({}).toArray();
    } catch (error) {
      logger.error("Demographic Turnout Turn", "Error fetching turnout data", error);
      throw error;
    }
  }

  // Get canvassing actions for this turn (from action queue)
  const canvassingActions = actions ?? (await getCanvassingActionsForTurn());

  for (const action of canvassingActions) {
    const state = stateTurnout.find((s) => s._id === action.stateId);
    if (!state) continue;

    // Country-aware lean lookup off the canvassed region's own country
    // (US-only lookup collapsed non-US targets to a (0,0) lean).
    const canvassLean = resolveCanvassGroup(
      state.countryId,
      action.demographic.category,
      action.demographic.group
    );
    const demoLean = canvassLean
      ? { economic: canvassLean.economicLean, social: canvassLean.socialLean }
      : { economic: 0, social: 0 };

    // Calculate effectiveness
    const boost = calculateCanvassingBoost(
      action.characterPosition,
      demoLean,
      action.isActiveCampaignSeason
    );

    // Apply with diminishing returns
    applyBoost(state, action.demographic, boost);
    state.lastUpdated = new Date();
  }

  // Save changes
  if (!turnoutData && turnoutCollection && stateTurnout.length > 0) {
    try {
      const ops = stateTurnout.map((state) => ({
        updateOne: {
          filter: { _id: state._id },
          update: { $set: { modifiers: state.modifiers, lastUpdated: state.lastUpdated } },
        },
      }));
      await turnoutCollection.bulkWrite(ops);
    } catch (error) {
      logger.error("Demographic Turnout Turn", "Error updating turnout data", error);
      throw error;
    }
  }

  return stateTurnout;
}

/**
 * Canvassing effects are applied immediately at action time via /api/canvassing,
 * not queued for turn processing. This function exists as a placeholder from an
 * earlier design that was superseded by immediate application.
 */
async function getCanvassingActionsForTurn(): Promise<CanvassingAction[]> {
  return [];
}

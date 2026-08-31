import type { AnyBulkWriteOperation, Db } from "mongodb";
import type { FederalBudget } from "@/lib/db/types/budget";
import type { GameConfig } from "@/lib/db/types/gameConfig";
import type { GovernmentFormation } from "@/lib/db/types/governmentFormation";
import type { Corporation, CorporateSector, SoeState } from "@/lib/db/types/corporation";
import {
  isPlannedEconomy,
  plannedShare,
  scheduledMarketizationLevel,
  DUAL_TRACK_CEILING,
  hydrateStoredMarketizationLevels,
  setStoredMarketizationLevel,
  marketizationLevel,
  marketizationDrift,
  driftMarketizationLevel,
  computePolicyStance,
  governmentReformismFromEconomicPosition,
  blendGovernmentReformism,
  marketizationGravity,
  NPP_DEFAULT_CREDIT_AGGRESSIVENESS,
  NPP_DEFAULT_BUDGET_SOFTNESS,
  NPP_DEFAULT_REFORMISM,
  NPP_DEFAULT_INTERNAL_REPRESSION,
} from "@/lib/constants/commandEconomy";
import {
  accumulateOverhang,
  shortageIndexFrom,
  blackMarketPremiumFrom,
  updateSecondEconomy,
  blackMarketPressure,
  overhangInjectionFromIssuance,
  repressionLegitimacyCost,
} from "@/lib/economy/commandEconomyState";
import {
  aggregatePlanFulfillment,
  aggregateCapacityUtilisation,
  resolveCreditAllocation,
  applyDirectedCreditToSoe,
  directedCreditBudget,
  directedCreditIssuance,
  directedCreditCapacityUnits,
  soeCapacityReplacementCostAnchor,
  SOE_PERF_BASELINE,
} from "@/lib/economy/soe";
import { getMarketSystemModeForDb, marketAtLeast } from "@/lib/market/featureFlag";
import { getRegisteredCountryIds } from "@/lib/country/registeredCountries";
import { capacityPricePerUnit, CAPACITY_ANCHOR_YEAR } from "@/lib/constants/capacityEconomy";
import { loadWorldEraUnitScale } from "@/lib/currency/gdpAnchorRate";
import {
  loadFxRatesByCurrency,
  fxRateForCorpFromMap,
  resolveCorpLiquidCurrencyCode,
  corpCapitalToAnchor,
  anchorToCorpCapital,
} from "@/lib/currency/corporationCapital";
import { wageFundConstrainedGrowth } from "@/lib/economy/twoCircuitMoney";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";

/**
 * Command-economy macro turn phase.
 *
 * P1/P3 (existing): advances the shortage-economy state on
 * `FederalBudget.economicFactors` — two-circuit wage-fund cap, monetary
 * overhang, shortage index, black-market premium, second economy.
 *
 * v2 P0: (1) refreshes each SOE's plan-fulfillment from its sectors' realized
 * output, and (2) makes marketization ENDOGENOUS — it hydrates the stored
 * per-country level (seeding from the era schedule the first time), then drifts
 * it each turn on black-market pressure + SOE performance + policy stance and
 * persists it, so every later phase this turn (and the next turn) reads the
 * drifted level through the unchanged `marketizationLevel` accessor.
 *
 * v2 P1 (active Gosbank): (a) DIRECTED CREDIT — each turn Gosbank lends a credit
 * budget (from its posture) across the country's SOEs, weighted toward
 * under-performing strategic sectors; the credit builds SOE capacity and lifts
 * output (growth over subsequent turns). (b) ISSUANCE → OVERHANG — the slice of
 * that credit not covered by real savings is monetized and injected into the
 * SAME overhang accumulator, so funding growth worsens shortages (the core
 * tradeoff). (c) BUDGET SOFTNESS is persisted per country for
 * `nppInsolvencyDissolution`. (d) the marketization `policyStance` term now
 * reads a REAL reform-vs-orthodox signal (government reformism + Gosbank
 * posture) instead of the P0 tolerance placeholder.
 *
 * Self-gates on `commandEconomyEnabled`; a no-op (byte-identical) for market
 * worlds / flag off. Runs after `inflationRecalc` so gdp/wage growth are fresh.
 */
export async function processCommandEconomyTurn(
  db: Db,
  _turn: number,
  currentYear?: number | null
): Promise<{ countriesUpdated: number }> {
  const config = await db
    .collection<GameConfig>("gameConfig")
    .findOne(
      { _id: "default" },
      { projection: { commandEconomyEnabled: 1, commandEconomySecondEconomyTolerance: 1 } }
    );
  const enabled = config?.commandEconomyEnabled === true;
  if (!enabled) return { countriesUpdated: 0 };

  const globalTolerance =
    typeof config?.commandEconomySecondEconomyTolerance === "number"
      ? config.commandEconomySecondEconomyTolerance
      : 0.3;

  // Per-country command posture from the NPP governing brain (commandStance):
  // second-economy tolerance + the P1 Gosbank levers (credit aggressiveness,
  // budget softness, government reformism). Absent → global / constant defaults.
  const formations = await db
    .collection<GovernmentFormation>("governmentFormations")
    .find({}, { projection: { _id: 1, commandStance: 1, governingPartyId: 1 } })
    .toArray();
  const toleranceByCountry = new Map<string, number>();
  const stanceByCountry = new Map<
    string,
    {
      creditAggressiveness?: number;
      budgetSoftness?: number;
      reformism?: number;
      internalRepression?: number;
    }
  >();
  const governingPartyIdByCountry = new Map<string, number>();
  for (const gov of formations) {
    const id = String(gov._id);
    // P3: the elected ruling party (largest party's sequentialId) — the LIVE
    // government-reformism source, resolved to an economic position below.
    if (gov.governingPartyId != null) {
      const seq = Number(gov.governingPartyId);
      if (Number.isFinite(seq)) governingPartyIdByCountry.set(id, seq);
    }
    const cs = gov.commandStance;
    if (!cs) continue;
    if (
      typeof cs.secondEconomyTolerance === "number" &&
      Number.isFinite(cs.secondEconomyTolerance)
    ) {
      toleranceByCountry.set(id, Math.max(0, Math.min(1, cs.secondEconomyTolerance)));
    }
    stanceByCountry.set(id, {
      creditAggressiveness: cs.creditAggressiveness,
      budgetSoftness: cs.budgetSoftness,
      reformism: cs.reformism,
      internalRepression: cs.internalRepression,
    });
  }

  // ── LIVE government reformism (P3): who actually governs moves marketization ──
  // Resolve each governing party's economic position (−5 command-left … +5
  // market-right) → reformism [−1, 1]. Works for player- AND NPP-led governments
  // and shifts as elections change control or the ruling party moves its stance,
  // closing the P2 seam where reformism was only ever the NPP-brain's estimate.
  const govReformismByCountry = new Map<string, number>();
  if (governingPartyIdByCountry.size > 0) {
    const partyFilter = Array.from(governingPartyIdByCountry.entries()).map(
      ([countryId, sequentialId]) => ({ countryId, sequentialId })
    );
    const parties = await db
      .collection("politicalParties")
      .find(
        { $or: partyFilter },
        { projection: { countryId: 1, sequentialId: 1, economicPosition: 1 } }
      )
      .toArray();
    for (const p of parties) {
      const countryId = String(p.countryId);
      if (governingPartyIdByCountry.get(countryId) !== Number(p.sequentialId)) continue;
      const reformism = governmentReformismFromEconomicPosition(
        p.economicPosition as number | null | undefined
      );
      if (reformism != null) govReformismByCountry.set(countryId, reformism);
    }
  }

  // ── SOE plan-fulfillment refresh (market output, not yet persisted) ─────────
  // Recompute each SOE's realized output from its sectors; directed credit is
  // applied below (planned countries) before we persist and score fulfillment.
  // P3b: under the plants tier directed credit must buy REAL capacity, and the
  // overlay's `capacity` must be read off the sectors' capital stock rather than
  // carried forward as a free-floating number.
  const plantsEnabled = marketAtLeast(await getMarketSystemModeForDb(db), "plants");
  const {
    byCountry: soeStatesByCountry,
    finalStateByCorp,
    replacementLocalByCorp,
  } = await loadSoeStates(db, plantsEnabled, currentYear);
  /** corpId → directed credit awarded this turn (corp-local), plants path only. */
  const plantsCreditByCorp = new Map<string, number>();

  const budgets = await db.collection<FederalBudget>("federalBudget").find({}).toArray();

  // ── Hydrate the stored marketization registry for this turn ───────────────
  //
  // Gated on the PERSISTED level (schedule as fallback), never on
  // `isPlannedEconomy`: that accessor reads the registry this loop is about to
  // rebuild — empty after a restart — and falls back to the compiled schedule,
  // which would silently drop (a) a country the schedule never listed whose
  // regime was carried onto it by a merge (post-reunification DE), and (b) a
  // command country whose stored level outlived its schedule's `throughYear`.
  // The band check itself uses the same ceiling `isPlannedEconomy` does.
  // A dissolved country keeps its budget doc for history, and the compiled
  // schedule keeps calling it planned — without this it would be hydrated and
  // planned for ever after a merge carried its regime to its successor.
  const registeredForPlanning = new Set<string>(await getRegisteredCountryIds(db));

  const hydration: Array<[string, number]> = [];
  for (const budget of budgets) {
    const countryId = budget.countryId;
    if (!countryId || !enabled) continue;
    if (!registeredForPlanning.has(countryId)) continue;
    const persisted = budget.economicFactors?.marketizationLevel;
    const level =
      typeof persisted === "number" && Number.isFinite(persisted)
        ? persisted
        : scheduledMarketizationLevel(countryId, currentYear);
    if (level >= DUAL_TRACK_CEILING) continue;
    hydration.push([countryId, level]);
  }
  hydrateStoredMarketizationLevels(hydration);

  let countriesUpdated = 0;
  for (const budget of budgets) {
    const countryId = budget.countryId;
    // Same registered gate as the hydration: an un-hydrated dissolved country
    // would otherwise fall back to its compiled schedule and read planned.
    if (!countryId || !registeredForPlanning.has(countryId)) continue;
    if (!isPlannedEconomy(countryId, currentYear, enabled)) continue;

    const share = plannedShare(countryId, currentYear, enabled);
    const factors = budget.economicFactors;
    const tolerance = toleranceByCountry.get(countryId) ?? globalTolerance;

    // ── Gosbank posture: P2 player directive > NPP commandStance > default ────
    const directive = factors?.gosbankDirective;
    const stance = stanceByCountry.get(countryId);
    const creditAggressiveness = firstFinite(
      [
        directive?.creditAggressiveness,
        stance?.creditAggressiveness,
        NPP_DEFAULT_CREDIT_AGGRESSIVENESS,
      ],
      0,
      1
    );
    const budgetSoftness = firstFinite(
      [directive?.budgetSoftness, stance?.budgetSoftness, NPP_DEFAULT_BUDGET_SOFTNESS],
      0,
      1
    );
    // Government reformism = the ruling party's CHARTERED line BLENDED with the
    // SITTING government's live command stance (not shadowed by it — see
    // `blendGovernmentReformism`). P3 gave the party position absolute
    // precedence, which froze the term: `politicalParties.economicPosition` is
    // written only by the player-only committee `positionShift` path, so in an
    // NPP-run one-party state it never changes and the dial could only fall.
    // Either input alone is used when it's the only one present; neither →
    // the neutral default.
    const reformism = firstFinite(
      [
        blendGovernmentReformism(govReformismByCountry.get(countryId), stance?.reformism),
        NPP_DEFAULT_REFORMISM,
      ],
      -1,
      1
    );

    // ── Internal repression: player directive > NPP stance > default ──────────
    // The hardliner's lever (0 none … 1 heavy): forces the black market down so
    // less shortage shows up as reform pressure, at a legitimacy cost below.
    const repressionDirectiveLevel = factors?.repressionDirective?.level;
    const internalRepression = firstFinite(
      [repressionDirectiveLevel, stance?.internalRepression, NPP_DEFAULT_INTERNAL_REPRESSION],
      0,
      1
    );

    // ── Directed credit → SOE capacity/output ────────────────────────────────
    const soes = soeStatesByCountry.get(countryId) ?? [];
    const aggPlanTarget = soes.reduce(
      (sum, s) => sum + (Number.isFinite(s.state.planTarget) ? s.state.planTarget : 0),
      0
    );
    const creditTotal = directedCreditBudget(aggPlanTarget, creditAggressiveness);
    // P2: honor the Gosbank Chair's explicit per-sector weighting when set, and
    // pull credit toward SOEs whose director requested investment.
    const allocation = resolveCreditAllocation(
      soes.map((s) => ({
        sector: s.state.sector,
        output: s.state.output,
        planTarget: s.state.planTarget,
        investmentRequest: s.state.directive?.investmentRequest,
      })),
      creditTotal,
      directive?.sectorCredit
    );
    const directedCreditReadout: Record<string, number> = {};
    // ── The replacement floor (the SOE capex channel) ────────────────────────
    //
    // Under plants an SOE's capacity is a PHYSICAL stock that depreciates every
    // turn, and the enterprise has no legitimate way to buy it back: the
    // treasury backstop deliberately covers only the operating loss (see
    // `coverableSoeShortfallAnchor` — that is what closed the P3b build-order
    // exploit), and the cash-rationed NPP reinvestment path is private-sector
    // machinery an SOE is excluded from. So the plan capacity ran one-way down.
    //
    // A state enterprise funds capacity from STATE channels. In a command
    // economy that channel already exists and is the intended one — directed
    // credit. All that was missing is a size guarantee: the Gosbank tranche is
    // an allocation of a posture-scaled budget, so a restrained posture (or a
    // large SOE in a small allocation) funded well under one turn of wear.
    // Floor each SOE's tranche at exactly one turn of depreciation replacement.
    //
    // BOUNDED, AND PAID FOR. The floor can only hold capacity flat — it is
    // priced off the plant that already exists (see
    // `soeCapacityReplacementCostAnchor`), so it can never fund growth, and it
    // is added to `creditTotal` BELOW so its monetized share feeds the monetary
    // overhang exactly like every other rouble the Gosbank prints. The state
    // pays, visibly.
    //
    // WHY THE FLOOR IGNORES THE CHAIR'S LEVER. `creditAggressiveness` sizes
    // INVESTMENT. Upkeep is not investment: an SOE has no other channel to buy
    // back the units that wore out, so a chair who could switch the floor off
    // would not be choosing restraint, they would be choosing to scrap the
    // plan capacity a few percent a turn with no way to notice. The lever
    // therefore reaches zero on the part it governs and the upkeep bill
    // continues, which is exactly how a command economy behaves.
    //
    // It is reported SEPARATELY (`directedCreditUpkeep`) for that reason: at
    // aggressiveness 0 the Gosbank still prints, and a chair staring at a zero
    // investment budget and a rising overhang has to be able to see why.
    let creditTotalFunded = creditTotal;
    let upkeepTotal = 0;
    for (const { corpId, state } of soes) {
      let credit = allocation.get(state.sector) ?? 0;
      if (plantsEnabled) {
        const replacementFloor = replacementLocalByCorp.get(corpId) ?? 0;
        if (replacementFloor > credit) {
          creditTotalFunded += replacementFloor - credit;
          upkeepTotal += replacementFloor - credit;
          credit = replacementFloor;
        }
        // Deferred: the credit is converted to capacity units and $inc'd onto
        // the corp's sectors in one pass after the country loop (below), then
        // folded into the overlay. Nothing is credited to the overlay here —
        // under plants the money must buy a plant before it counts.
        plantsCreditByCorp.set(corpId, (plantsCreditByCorp.get(corpId) ?? 0) + credit);
      } else {
        finalStateByCorp.set(corpId, applyDirectedCreditToSoe(state, credit));
      }
      directedCreditReadout[state.sector] = Math.round(credit);
    }
    // Score AFTER credit — funding the right sectors lifts output.
    //
    // Two different scores, deliberately:
    //  - `soeFulfillment` (output / planTarget) is the DIRECTOR'S grade and the
    //    goods-availability signal, because a plan the enterprises missed is
    //    consumer goods the wage fund already paid for. It feeds the overhang.
    //  - `soePerf` (output / capacity) drives the MARKETIZATION dial, because
    //    `planTarget` is written by the Gosplan chair and using it here let the
    //    planner choose the denominator of their own grade and steer a world
    //    scalar with it. See `aggregateCapacityUtilisation`.
    const scoredSoes = soes.map((s) => finalStateByCorp.get(s.corpId)!);
    const soeFulfillment =
      soes.length > 0 ? aggregatePlanFulfillment(scoredSoes) : SOE_PERF_BASELINE;
    const soePerf = soes.length > 0 ? aggregateCapacityUtilisation(scoredSoes) : SOE_PERF_BASELINE;

    // ── Issuance → overhang (the tradeoff) ───────────────────────────────────
    // `creditTotalFunded` (not `creditTotal`) — the replacement floor above is
    // real credit and prints its unbacked share like any other tranche.
    const monetizedIssuance = directedCreditIssuance(creditTotalFunded);
    const creditInjection = overhangInjectionFromIssuance(monetizedIssuance, aggPlanTarget, share);

    const prevOverhang = factors?.monetaryOverhang ?? 0;
    const prevSecondShare = factors?.secondEconomyShare ?? 0;

    const constrainedWageGrowth = wageFundConstrainedGrowth(
      factors?.wageGrowth ?? 0,
      factors?.gdpGrowth ?? 0,
      share
    );

    const relief = updateSecondEconomy(
      prevSecondShare,
      factors?.shortageIndex ?? 0,
      prevOverhang,
      tolerance
    ).relief;

    const overhang = accumulateOverhang(
      prevOverhang,
      constrainedWageGrowth,
      factors?.gdpGrowth ?? 0,
      share,
      relief,
      creditInjection,
      soeFulfillment
    );
    const shortageIndex = shortageIndexFrom(overhang);
    const blackMarketPremium = blackMarketPremiumFrom(shortageIndex, overhang, tolerance);
    const secondEconomyShare = updateSecondEconomy(
      prevSecondShare,
      shortageIndex,
      overhang,
      tolerance
    ).share;

    // ── Endogenous marketization drift (fully free — no era gravity) ────────
    // Repression forces the black-market EXPRESSION down (premium + grey market),
    // so the effective pressure that drives reform is lower than the raw scarcity
    // would imply. The base (no-repression) pressure is kept as a readout so the
    // dashboard can show how far repression pushed it down. The overhang / shortage
    // computed above are untouched by repression — the goods still aren't there.
    const pressureBase = blackMarketPressure(shortageIndex, blackMarketPremium, secondEconomyShare);
    const pressure = blackMarketPressure(
      shortageIndex,
      blackMarketPremium,
      secondEconomyShare,
      internalRepression
    );
    // Legitimacy cost readout (also recomputed + applied by the one-party
    // legitimacy phase); climbs with repression × the still-present shortage.
    const repressionCost = repressionLegitimacyCost(internalRepression, shortageIndex);
    const policyStance = computePolicyStance(reformism, creditAggressiveness, budgetSoftness);
    const currentLevel = marketizationLevel(countryId, currentYear);
    // Free drivers + a weak, capped restoring pull toward the era schedule.
    // Gravity is exactly 0 while the level sits at its scheduled value and is
    // capped well below what the drivers can sustain, so it sets the DEFAULT
    // when nobody intervenes without ever railroading a determined government.
    const gravity = marketizationGravity(
      currentLevel,
      scheduledMarketizationLevel(countryId, currentYear)
    );
    const drift = marketizationDrift(pressure, soePerf, policyStance) + gravity;
    const nextLevel = driftMarketizationLevel(currentLevel, drift);
    setStoredMarketizationLevel(countryId, nextLevel);

    await db.collection<FederalBudget>("federalBudget").updateOne(
      { _id: budget._id },
      {
        $set: {
          "economicFactors.monetaryOverhang": overhang,
          "economicFactors.shortageIndex": shortageIndex,
          "economicFactors.blackMarketPremium": blackMarketPremium,
          "economicFactors.secondEconomyShare": secondEconomyShare,
          "economicFactors.wageGrowth": constrainedWageGrowth,
          "economicFactors.marketizationLevel": nextLevel,
          "economicFactors.budgetSoftness": budgetSoftness,
          "economicFactors.governmentReformism": reformism,
          "economicFactors.internalRepression": internalRepression,
          "economicFactors.repressionLegitimacyCost": repressionCost,
          "economicFactors.blackMarketPressureBase": pressureBase,
          "economicFactors.blackMarketPressureEffective": pressure,
          "economicFactors.directedCredit": directedCreditReadout,
          "economicFactors.directedCreditIssuance": Math.round(monetizedIssuance),
          // The slice of this turn's credit that only replaced worn-out
          // capacity. Zero when the investment budget already covered every
          // SOE's wear; positive whenever the floor had to top one up, which
          // is the whole of the bill at a zero-aggressiveness posture.
          "economicFactors.directedCreditUpkeep": Math.round(upkeepTotal),
        },
      }
    );
    countriesUpdated += 1;
  }

  // P3b: turn this turn's directed credit into real capacity on real sectors,
  // then fold what it bought into the overlay. Runs AFTER the country loop
  // because it is one bulk write over every planned country's SOE sectors.
  //
  // Ordering note: `soePerf` was already scored above without it, which is
  // correct under plants — plan fulfillment is output/planTarget and this
  // purchase raises CAPACITY, whose output arrives next turn when the sectors
  // actually produce from the larger capital stock. Below plants the (phantom)
  // same-turn output lift is preserved exactly.
  if (plantsEnabled && plantsCreditByCorp.size > 0) {
    const valueAdded = await buildCapacityFromDirectedCredit(db, plantsCreditByCorp, currentYear);
    for (const [corpId, capacityValueAdded] of valueAdded) {
      const state = finalStateByCorp.get(corpId);
      if (!state) continue;
      finalStateByCorp.set(
        corpId,
        applyDirectedCreditToSoe(state, plantsCreditByCorp.get(corpId) ?? 0, {
          capacityValueAdded,
        })
      );
    }
  }

  // Persist every SOE overlay (credited where a planned country funded it, plain
  // market-output refresh otherwise) in one bulk write.
  await persistSoeStates(db, finalStateByCorp);

  return { countriesUpdated };
}

/** First finite entry in `values`, clamped to [lo, hi]. Falls back to lo. */
function firstFinite(values: Array<number | undefined | null>, lo: number, hi: number): number {
  for (const v of values) {
    if (typeof v === "number" && Number.isFinite(v)) return Math.max(lo, Math.min(hi, v));
  }
  return lo;
}

/**
 * Signed reform-vs-orthodox policy stance in [-1, 1] from the NPP governing
 * brain's second-economy tolerance. RETAINED for back-compat / tests only — the
 * turn now uses {@link computePolicyStance} (government reformism + Gosbank
 * posture). A regime that tolerates the grey market reads as more reformist.
 * @deprecated P1 replaced this with computePolicyStance.
 */
export function policyStanceFromTolerance(tolerance: number | undefined | null): number {
  const tol = typeof tolerance === "number" && Number.isFinite(tolerance) ? tolerance : 0.3;
  return Math.max(-1, Math.min(1, (tol - 0.4) * 2));
}

/**
 * Recompute every SOE's overlay from its sectors' realized output (WITHOUT
 * persisting — the caller applies directed credit for planned countries first,
 * then persists). Returns the per-country grouping and a corpId → state map
 * seeded with the market-output refresh (credit overwrites entries in place).
 *
 * output       = Σ sector realizedRevenue (falls back to nominal revenue).
 * planTarget   = the seeded plan quota (unchanged in P0; Gosplan sets it in P2).
 * efficiency   = EMA of output/capacity (how well capacity is being used).
 * cumulativeLosses accrues the per-turn plan shortfall (soft budget).
 */
async function loadSoeStates(
  db: Db,
  /**
   * P3b (plants tier): derive `capacity` from the sectors' CAPITAL STOCK priced
   * at their output mix, instead of carrying the previous overlay value
   * forward. See the comment at the assignment below.
   */
  plantsEnabled: boolean = false,
  /** Game year, for era-pricing the replacement floor. Plants path only. */
  currentYear?: number | null
): Promise<{
  byCountry: Map<string, Array<{ corpId: string; state: SoeState }>>;
  finalStateByCorp: Map<string, SoeState>;
  /**
   * corpId → the CORP-LOCAL cost of replacing one turn of depreciation on the
   * capacity it already owns. The floor the Gosbank tranche is lifted to under
   * plants — see `soeCapacityReplacementCostAnchor`. Empty below plants.
   */
  replacementLocalByCorp: Map<string, number>;
}> {
  const byCountry = new Map<string, Array<{ corpId: string; state: SoeState }>>();
  const finalStateByCorp = new Map<string, SoeState>();
  const replacementLocalByCorp = new Map<string, number>();

  const soeCorps = await db
    .collection<Corporation>("corporations")
    .find(
      { soe: { $exists: true } },
      { projection: { _id: 1, countryId: 1, soe: 1, liquidCurrencyCode: 1 } }
    )
    .toArray();
  if (soeCorps.length === 0) return { byCountry, finalStateByCorp, replacementLocalByCorp };

  const soeIds = soeCorps.map((c) => c._id);
  const sectors = await db
    .collection<CorporateSector>("corporateSectors")
    .find(
      { corporationId: { $in: soeIds } },
      {
        projection: {
          corporationId: 1,
          revenue: 1,
          realizedRevenue: 1,
          capitalStock: 1,
          sectorType: 1,
        },
      }
    )
    .toArray();

  if (plantsEnabled) {
    const fxByCurrency = await loadFxRatesByCurrency(db);
    const sectorsByCorp = new Map<string, CorporateSector[]>();
    for (const sec of sectors) {
      const k = String(sec.corporationId);
      sectorsByCorp.set(k, [...(sectorsByCorp.get(k) ?? []), sec]);
    }
    const soeUnitScale = await loadWorldEraUnitScale(db);
    for (const corp of soeCorps) {
      const anchor = soeCapacityReplacementCostAnchor(
        sectorsByCorp.get(String(corp._id)) ?? [],
        currentYear,
        soeUnitScale
      );
      if (!(anchor > 0)) continue;
      const local = anchorToCorpCapital(
        anchor,
        resolveCorpLiquidCurrencyCode(corp),
        fxRateForCorpFromMap(corp, fxByCurrency)
      );
      if (local > 0) replacementLocalByCorp.set(String(corp._id), local);
    }
  }

  const realizedByCorp = new Map<string, number>();
  const nominalByCorp = new Map<string, number>();
  /** Σ capitalStock × mixPrice — the plants-tier capacity valuation. */
  const capacityValueByCorp = new Map<string, number>();
  for (const sec of sectors) {
    const key = String(sec.corporationId);
    const nominal = Number.isFinite(sec.revenue) ? sec.revenue : 0;
    // Under plants a sector's stored `revenue` IS `capitalStock × mixPrice`
    // (sectorTurn writes the capacity-implied nameplate, deliberately not the
    // realized figure), so mixPrice = revenue / capitalStock and the product
    // below is the capacity valuation stated in the same currency as
    // `planTarget`. Written the long way on purpose: it is the identity that
    // makes this a CAPACITY reading rather than a revenue sum, and it goes to
    // zero for a sector with no capital stock instead of inheriting a
    // compounding revenue number.
    const capitalStock = Number.isFinite(sec.capitalStock) ? (sec.capitalStock as number) : 0;
    if (capitalStock > 0) {
      const mixPrice = nominal / capitalStock;
      capacityValueByCorp.set(key, (capacityValueByCorp.get(key) ?? 0) + capitalStock * mixPrice);
    }
    const realized =
      typeof sec.realizedRevenue === "number" && Number.isFinite(sec.realizedRevenue)
        ? sec.realizedRevenue
        : nominal;
    realizedByCorp.set(key, (realizedByCorp.get(key) ?? 0) + realized);
    nominalByCorp.set(key, (nominalByCorp.get(key) ?? 0) + nominal);
  }

  for (const corp of soeCorps) {
    const prev = corp.soe;
    if (!prev) continue;
    const key = String(corp._id);
    const realized = realizedByCorp.get(key);
    const output = realized != null ? Math.round(realized) : prev.output;
    const planTarget =
      prev.planTarget > 0 ? prev.planTarget : Math.round(nominalByCorp.get(key) ?? 0);
    const plantsCapacityValue = Math.round(capacityValueByCorp.get(key) ?? 0);
    const capacity =
      plantsEnabled && plantsCapacityValue > 0
        ? plantsCapacityValue
        : prev.capacity > 0
          ? prev.capacity
          : Math.max(output, planTarget);
    const capUse = capacity > 0 ? output / capacity : 1;
    // P2: the director's labour-vs-quality lever nudges the efficiency trend —
    // a quality focus (>0.5) lifts it, a raw-output focus (<0.5) drags it.
    const laborQuality = prev.directive?.laborQuality;
    const qualityBias =
      typeof laborQuality === "number" && Number.isFinite(laborQuality)
        ? (laborQuality - 0.5) * 0.2
        : 0;
    const efficiency = clampNum((prev.efficiency ?? 1) * 0.9 + (capUse + qualityBias) * 0.1, 0, 3);
    const shortfall = Math.max(0, planTarget - output);
    const cumulativeLosses = (prev.cumulativeLosses ?? 0) + shortfall / TURNS_PER_YEAR;

    const next: SoeState = {
      ...prev,
      output,
      planTarget,
      capacity,
      efficiency,
      cumulativeLosses,
    };
    finalStateByCorp.set(key, next);
    const country = corp.countryId ?? "";
    if (!byCountry.has(country)) byCountry.set(country, []);
    byCountry.get(country)!.push({ corpId: key, state: next });
  }

  return { byCountry, finalStateByCorp, replacementLocalByCorp };
}

/**
 * P3b — turn directed credit into REAL capacity (plants tier only).
 *
 * For each credited SOE:
 *   1. split the tranche across its sectors pro-rata by existing `capitalStock`
 *      (the overlay has no sector-level plan, and capital stock is the closest
 *      thing to "where this enterprise actually operates"; an SOE with no
 *      capital anywhere splits it evenly so a from-scratch enterprise can still
 *      be built up),
 *   2. buy units at `capacityPricePerUnit(sectorType, year)` — the SAME
 *      era-priced ₳/unit a private CEO pays via the build path, so directed
 *      credit is a FUNDING channel, not a discount,
 *   3. `$inc` the units onto `capitalStock`.
 *
 * DEVIATION, documented: the purchase lands as capacity IMMEDIATELY rather than
 * through the P3a build queue's construction lag. The Gosbank tranche is a
 * per-turn flow spread across every SOE sector in the country, so queueing it
 * would mint one build order per sector per turn forever; and the overlay it
 * feeds is a plan-fulfillment reading, not a balance sheet. The monetary
 * overhang accounting (`directedCreditIssuance`) is untouched either way — the
 * credit still prints its unbacked share.
 *
 * FX: `credit` is in corp-local currency (it is derived from `planTarget`,
 * which is a sum of sector revenue), while `capacityPricePerUnit` is ₳. Each
 * corp's own rate normalizes the tranche before pricing.
 *
 * Returns corpId → capacity value added, in the SAME corp-local units as the
 * overlay's `capacity` (unitsAdded × mixPrice), so the caller can fold it into
 * `SoeState` without re-deriving prices.
 */
async function buildCapacityFromDirectedCredit(
  db: Db,
  creditByCorp: ReadonlyMap<string, number>,
  currentYear: number | null | undefined
): Promise<Map<string, number>> {
  const valueAddedByCorp = new Map<string, number>();
  const { ObjectId } = await import("mongodb");
  const corpIds = [...creditByCorp.keys()].map((id) => new ObjectId(id));
  const [corps, sectors, fxByCurrency] = await Promise.all([
    db
      .collection<Corporation>("corporations")
      .find({ _id: { $in: corpIds } }, { projection: { _id: 1, liquidCurrencyCode: 1 } })
      .toArray(),
    db
      .collection<CorporateSector>("corporateSectors")
      .find(
        { corporationId: { $in: corpIds } },
        {
          projection: {
            _id: 1,
            corporationId: 1,
            sectorType: 1,
            capitalStock: 1,
            capacityBookAnchor: 1,
            revenue: 1,
          },
        }
      )
      .toArray(),
    loadFxRatesByCurrency(db),
  ]);
  const corpById = new Map(corps.map((c) => [String(c._id), c]));
  const sectorsByCorp = new Map<string, CorporateSector[]>();
  for (const s of sectors) {
    const k = String(s.corporationId);
    sectorsByCorp.set(k, [...(sectorsByCorp.get(k) ?? []), s]);
  }

  const year = currentYear ?? CAPACITY_ANCHOR_YEAR;
  const creditUnitScale = await loadWorldEraUnitScale(db);
  const ops: AnyBulkWriteOperation<CorporateSector>[] = [];
  for (const [corpId, creditLocal] of creditByCorp) {
    if (!(creditLocal > 0)) continue;
    const corpSectors = sectorsByCorp.get(corpId) ?? [];
    if (corpSectors.length === 0) continue;
    const corp = corpById.get(corpId);
    const code = corp ? resolveCorpLiquidCurrencyCode(corp) : undefined;
    const rate = corp ? fxRateForCorpFromMap(corp, fxByCurrency) : 1;
    const creditAnchor = corpCapitalToAnchor(creditLocal, code, rate);
    if (!(creditAnchor > 0)) continue;

    const stockTotal = corpSectors.reduce(
      (sum, s) =>
        sum + Math.max(0, Number.isFinite(s.capitalStock) ? (s.capitalStock as number) : 0),
      0
    );
    let valueAddedLocal = 0;
    for (const sector of corpSectors) {
      const stock = Math.max(
        0,
        Number.isFinite(sector.capitalStock) ? (sector.capitalStock as number) : 0
      );
      const share = stockTotal > 0 ? stock / stockTotal : 1 / corpSectors.length;
      const unitPrice = capacityPricePerUnit(sector.sectorType, year, creditUnitScale);
      const unitsAdded = directedCreditCapacityUnits(creditAnchor * share, unitPrice);
      if (!(unitsAdded > 0)) continue;
      // P5: directed credit is REAL cash spent at the standing list price, so it
      // adds a real paid basis — the SOE can exit this capacity for what the
      // state paid for it, and no more. Written as an absolute `$set` (with the
      // list-price fallback as the prior) rather than an `$inc`, so a sector
      // that has no recorded basis yet is stamped at its honest value instead
      // of being reset to just this tranche.
      const priorBook =
        typeof sector.capacityBookAnchor === "number" &&
        Number.isFinite(sector.capacityBookAnchor) &&
        sector.capacityBookAnchor >= 0
          ? sector.capacityBookAnchor
          : stock * unitPrice;
      ops.push({
        updateOne: {
          filter: { _id: sector._id },
          update: {
            $inc: { capitalStock: unitsAdded },
            $set: { capacityBookAnchor: priorBook + unitsAdded * unitPrice },
          },
        },
      });
      // mixPrice (corp-local) = revenue / capitalStock under plants; a sector
      // with no stock yet has no price to read, so its purchase is valued at
      // the tranche that bought it (the anchor→local round trip).
      const revenue = Number.isFinite(sector.revenue) ? sector.revenue : 0;
      valueAddedLocal +=
        stock > 0 && revenue > 0
          ? unitsAdded * (revenue / stock)
          : anchorToCorpCapital(creditAnchor * share, code, rate);
    }
    if (valueAddedLocal > 0) valueAddedByCorp.set(corpId, valueAddedLocal);
  }
  if (ops.length > 0) await db.collection<CorporateSector>("corporateSectors").bulkWrite(ops);
  return valueAddedByCorp;
}

/** Bulk-persist the final SOE overlays (post market-refresh + directed credit). */
async function persistSoeStates(db: Db, finalStateByCorp: Map<string, SoeState>): Promise<void> {
  if (finalStateByCorp.size === 0) return;
  const { ObjectId } = await import("mongodb");
  const ops: AnyBulkWriteOperation<Corporation>[] = [];
  for (const [corpId, state] of finalStateByCorp) {
    ops.push({
      updateOne: { filter: { _id: new ObjectId(corpId) }, update: { $set: { soe: state } } },
    });
  }
  await db.collection<Corporation>("corporations").bulkWrite(ops);
}

const clampNum = (v: number, lo: number, hi: number): number =>
  !Number.isFinite(v) ? lo : Math.min(hi, Math.max(lo, v));

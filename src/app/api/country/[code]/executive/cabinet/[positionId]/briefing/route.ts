// GET /api/country/[code]/executive/cabinet/[positionId]/briefing
// Auth: public (actions restricted on frontend)
// Errors: 404
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import {
  findMergedRegionMetricsForDisplay,
  findMergedRegionMetricsManyForDisplay,
} from "@/lib/macroMetrics/displayMerge";
import { getDb } from "@/lib/mongodb";
import { getAuthUserWithCharacter } from "@/lib/auth";
import { handleRouteError } from "@/lib/api/errors";
import { getCabinetMechanics, getCabinetPositions } from "@/lib/constants/cabinetMechanics";
import { resolveDepartment, resolveSeatName } from "@/lib/cabinet/rosterEra";
import { resolveGameYear } from "@/lib/era/era";
import { getMinisterialOrders } from "@/lib/constants/cabinetOrders";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getNationalDocId } from "@/lib/constants/nationalScope";
import { getEnabledCountryIds } from "@/lib/countryAccess";
import {
  DEFENSE_POSITION_BY_COUNTRY,
  aggregateForce,
  computeEffectivePower,
  computeEffectiveUpkeep,
} from "@/lib/constants/military";
import { getMilitaryUnitsCollection } from "@/lib/db/collections/militaryUnits";
import { getNationalDoctrine, settleDoctrineIncome } from "@/lib/db/collections/nationalDoctrine";
import { getMilitaryCommands } from "@/lib/db/collections/militaryCommands";
import { getMilitaryFormations } from "@/lib/db/collections/militaryFormations";
import type { ConflictAssignment } from "@/lib/military/assignments";
import {
  listCountryGenerals,
  listCountryCorps,
  listCommissionCandidates,
  type CorpsMember,
} from "@/lib/db/collections/characterGenerals";
import { listPendingDeclarations } from "@/lib/db/collections/battleDeclarations";
import { listRecentBattleReports } from "@/lib/db/collections/battleReports";
import { listTheaterStates } from "@/lib/db/collections/theaterState";
import { listActiveConflicts } from "@/lib/db/collections/conflicts";
import { getNationalManpower } from "@/lib/db/collections/nationalManpower";
import { resolveConscriptionStanceFor } from "@/lib/military/conscriptionLaw";
import { ATTRITION } from "@/lib/military/config";
import { manpowerCeiling } from "@/lib/military/manpower";
import { computeRegionThreats } from "@/lib/military/regionThreat";
import { loadMilitaryBlocs } from "@/lib/military/blocLookup";
import { homeRegionOf } from "@/lib/military/regionTopology";
import type { CommanderRef, ThreatLevel } from "@/lib/military/types";
import { resolveDoctrineEra } from "@/lib/military/currentDoctrineEra";
import type { MilitaryCommand } from "@/lib/military/types";
import { isProspectingEnabled } from "@/lib/extraction/featureFlag";
import { resolveDefenseLineFrom } from "@/lib/turn/defenseEnvelope";
import { getDefenseAppropriation } from "@/lib/db/collections/defenseAppropriation";
import { getNationalArsenal } from "@/lib/db/collections/nationalArsenal";
import { listOpenContracts } from "@/lib/db/collections/defenceContracts";
import {
  listDefenceSuppliers,
  type DefenceSupplierView,
} from "@/lib/corporations/queries/defenceSuppliers";
import { lotPrice } from "@/lib/military/arsenal";
import { militaryPriceAnchor } from "@/lib/military/procurement";
import type { NationalArsenal } from "@/lib/db/types/nationalArsenal";
import type { DefenceContractView } from "@/app/country/[code]/executive/cabinet/[positionId]/office/useCabinetOffice";
import { accrualPerTurn, upkeepPerTurn } from "@/lib/military/appropriation";
import { seedRosterUpkeepFor } from "@/lib/military/seedRosterUpkeep";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";
import {
  resolveEstatePortfolio,
  aggregateEstates,
  computeEffectiveOutput as computeEstateOutput,
  computeEffectiveUpkeep as computeEstateUpkeep,
} from "@/lib/constants/cabinetEstates";
import { getCabinetEstatesCollection } from "@/lib/db/collections/cabinetEstates";
import { resolvePortfolioEnvelope } from "@/lib/turn/portfolioEnvelope";
import {
  resolveEnergyPosition,
  aggregateMix,
  effectiveCapacity as energyEffectiveCapacity,
  effectiveUpkeep as energyEffectiveUpkeep,
} from "@/lib/constants/cabinetEnergy";
import { getEnergyPlantsCollection } from "@/lib/db/collections/energyPlants";
import { resolveEnergyEnvelope } from "@/lib/turn/energyEnvelope";
import {
  resolveInfraPosition,
  aggregateInfra,
  effectiveOutput as infraEffectiveOutput,
  turnsRemaining,
  progressPct,
  buildFundingDef,
} from "@/lib/constants/cabinetInfra";
import { getInfraProjectsCollection } from "@/lib/db/collections/infraProjects";
import { resolveInfraEnvelope } from "@/lib/turn/infraEnvelope";
import { resolveFinancePosition } from "@/lib/constants/cabinetMonetary";
import { getSovereignConfidencePremium } from "@/lib/budget/debt";
import { INVESTOR_CONFIDENCE_BASELINE } from "@/lib/nationalization/constants";
import { getTreasuryOperationsCollection } from "@/lib/db/collections/treasuryOperations";
import type { ExchangeRate } from "@/lib/db/types/exchangeRate";
import type { StateMetrics, PoliticalParty, Character } from "@/lib/db/types";
import type { RegionalBudget } from "@/lib/db/types/regionalBudget";
import type { FederalBudget } from "@/lib/db/types/budget";
import type { CentralBank } from "@/lib/db/types/centralBank";
import type { Bond } from "@/lib/db/types";
import { getNationalBudgetId } from "@/lib/bonds/sovereign";
import { getBankId } from "@/lib/centralBank/helpers";
import { resolveNationalMetricValue } from "@/lib/cabinet/nationalMetricSource";
import { getCabinetMembersCollection } from "@/lib/db/collections/cabinetMembers";
import {
  getCabinetSettingsCollection,
  getMinisterialOrdersCollection,
} from "@/lib/db/collections/cabinetSettings";
import { getGameState } from "@/lib/gameState";
import {
  expireMinisterialOrders,
  isMinisterialOrderActive,
} from "@/lib/cabinet/ministerialOrderLifecycle";

interface RouteParams {
  params: Promise<{ code: string; positionId: string }>;
}

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { code, positionId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country" }, { status: 400 });
    }

    const mechanics = getCabinetMechanics(countryId, positionId);
    if (!mechanics) {
      return NextResponse.json({ error: "Unknown cabinet position" }, { status: 404 });
    }

    const db = await getDb();
    const user = await getAuthUserWithCharacter();
    const gameState = await getGameState(db);
    const currentTurn = gameState?.currentTurn ?? 1;
    // Live year for era-resolved seat name + department (null = canonical).
    const liveYear = gameState ? resolveGameYear(gameState) : null;
    const positionDef = getCabinetPositions(countryId).find((p) => p.id === positionId);
    await expireMinisterialOrders(db, currentTurn);

    // Fetch current holder, settings, active orders in parallel
    const [member, setting, activeOrderDocs, enabledCountryIds] = await Promise.all([
      getCabinetMembersCollection(db).findOne({ countryId, positionId }),
      getCabinetSettingsCollection(db).findOne({ _id: `${countryId}_${positionId}` }),
      getMinisterialOrdersCollection(db).find({ positionId, countryId, active: true }).toArray(),
      getEnabledCountryIds(),
    ]);
    const activeOrders = activeOrderDocs.filter((order) =>
      isMinisterialOrderActive(order, currentTurn)
    );

    // Look up party info and character sequentialId for the current holder
    const [partyDoc, holderChar] = member
      ? await Promise.all([
          member.party
            ? db
                .collection<PoliticalParty>("politicalParties")
                .findOne(
                  { countryId, sequentialId: Number(member.party) },
                  { projection: { name: 1, color: 1, logoUrl: 1 } }
                )
            : null,
          member.characterId
            ? db
                .collection<Character>("characters")
                .findOne(
                  { _id: member.characterId },
                  { projection: { sequentialId: 1, avatarUrl: 1, borderKey: 1, tintColor: 1 } }
                )
            : null,
        ])
      : [null, null];

    // Determine if current user can perform actions
    const isHolder = !!(
      user &&
      member &&
      member.characterId &&
      member.characterId.toString() === user.character?._id?.toString()
    );
    const isAdmin = !!user?.isAdmin;
    const canAct = isHolder || isAdmin;

    // Fetch metrics based on position config
    const regionIds = mechanics.singleRegionFocus ? [mechanics.singleRegionFocus] : undefined;
    const nationalDocId = getNationalDocId(countryId) ?? null;

    // Fetch state metrics for country regions
    const countryStates = await db
      .collection("states")
      .find({ countryId })
      .project({ _id: 1, name: 1, population: 1 })
      .toArray();

    const stateIds = regionIds ?? countryStates.map((s) => s._id);
    const budgetId = getNationalBudgetId(countryId);
    // Some macro metrics on the stat strip are sourced from the central bank
    // (e.g. the prime/interest rate) rather than stateMetrics — fetch the bank
    // only when a requested metric actually needs it.
    const needsCentralBank = mechanics.nationalMetrics.some((m) => m.source === "centralBank");
    const [stateMetrics, nationalMetricsDoc, regionalBudgets, budget, sovereignBonds, bank] =
      await Promise.all([
        // SP5: merged two-store views (cabinet stat strips span macro +
        // political metrics; playable political rows read absent -> 0, the
        // documented parked channel).
        findMergedRegionMetricsManyForDisplay(db, { _id: { $in: stateIds } }),
        nationalDocId
          ? findMergedRegionMetricsForDisplay(db, { _id: nationalDocId })
          : Promise.resolve(null),
        mechanics.allocation || positionId === "chancellor"
          ? // Scope by CURRENT state ids (not countryId) so stale orphan
            // regionalBudgets from prior region-id schemes — e.g. CN's pre-rename
            // NORTHEAST/EAST/… docs alongside the live DB/HB/… ones — are excluded
            // and the funding pool is not inflated. Mirrors federalBudgetDetail and
            // calculateFederalSpending, which the National Budget page reads.
            db
              .collection<RegionalBudget>("regionalBudgets")
              .find({ _id: { $in: stateIds } })
              .toArray()
          : Promise.resolve([]),
        db.collection<FederalBudget>("federalBudget").findOne({ _id: budgetId }),
        db
          .collection<Bond>("bonds")
          .find({ issuerType: "sovereign", countryId, matured: false, defaulted: false })
          .toArray(),
        needsCentralBank
          ? db.collection<CentralBank>("centralBanks").findOne({ _id: getBankId(countryId) })
          : Promise.resolve(null),
      ]);

    // Resolve each metric from its declared source: stateMetrics (national doc
    // then regional average), the federal budget (inflation), or the central
    // bank (prime/interest rate). See resolveNationalMetricValue for why a few
    // macro metrics cannot be read from stateMetrics.
    const nationalMetrics: Record<string, number> = {};
    for (const metric of mechanics.nationalMetrics) {
      nationalMetrics[`${metric.category}.${metric.metricId}`] = resolveNationalMetricValue({
        metric,
        nationalMetricsDoc,
        stateMetrics,
        budget,
        bank,
      });
    }

    // Build per-region data. Only stateMetrics-sourced metrics have per-region
    // values; budget/centralBank metrics (inflation, prime rate) are national
    // concepts with no regional breakdown, so they are skipped here.
    const regionData = stateMetrics.map((sm) => {
      const state = countryStates.find((s) => s._id === sm._id);
      const metrics: Record<string, number> = {};
      for (const metric of [...mechanics.nationalMetrics, ...mechanics.regionalMetrics]) {
        if (metric.source && metric.source !== "stateMetrics") continue;
        const key = `${metric.category}.${metric.metricId}`;
        if (metrics[key] !== undefined) continue; // dedupe
        const cat = sm[metric.category as keyof StateMetrics] as
          Record<string, { value?: number }> | undefined;
        metrics[key] = cat?.[metric.metricId]?.value ?? 0;
      }
      return {
        regionId: sm._id,
        regionName: state?.name ?? sm._id,
        population: state?.population ?? 0,
        metrics,
      };
    });

    // Defense seat: attach the military order-of-battle + force aggregates + national doctrine.
    let units: Record<string, unknown>[] | undefined;
    let forceSummary: Record<string, unknown> | undefined;
    let doctrine: { adopted: Record<string, number>; points: number } | undefined;
    let doctrineEra: number | undefined;
    let commands: MilitaryCommand[] | undefined;
    let commanders: CommanderRef[] | undefined;
    let conflictAssignments: ConflictAssignment[] | undefined;
    let corps: CorpsMember[] | undefined;
    let commissionCandidates: { characterId: string; name: string }[] | undefined;
    let regionThreats: Record<string, ThreatLevel> | undefined;
    /** Defense seat only: the national materiel store and the contracts filling it. */
    let arsenal: NationalArsenal | undefined;
    let contracts: DefenceContractView[] | undefined;
    /** Plants the minister may award to, and what a lot from them costs. */
    let suppliers: DefenceSupplierView[] | undefined;
    let lotPricePerLot: number | null | undefined;
    let manpower:
      | {
          pool: number;
          mode: "off" | "trained" | "conscript";
          regenPerTurn: number;
          poolCap: number;
          stanceLabel: string;
          conscriptAllowed: boolean;
        }
      | undefined;
    if (DEFENSE_POSITION_BY_COUNTRY[countryId] === positionId) {
      const tier = setting?.tierSetting ?? "standard";
      const rawUnits = await getMilitaryUnitsCollection(db).find({ countryId }).toArray();
      units = rawUnits.map((u) => ({
        ...u,
        _id: String(u._id),
        effectivePower: computeEffectivePower(u),
        effectiveUpkeep: computeEffectiveUpkeep(u, countryId, tier),
      }));
      const forceAgg = aggregateForce(rawUnits, countryId, tier);
      // The defence account the recruit panel prices against and the masthead reports.
      // The line comes from the budget already loaded above rather than a second read.
      const defenceLine = resolveDefenseLineFrom(budget ?? null);
      const appropriationPot = await getDefenseAppropriation(db, countryId);
      forceSummary = {
        ...forceAgg,
        treasuryBalance: budget?.treasuryBalance ?? 0,
        // `?? null`, NOT `?? 0` — a zero gdp is exactly what makes units free.
        // Carry the absence through so the panel disables rather than prices at 0.
        gdp: budget?.gdp ?? null,
        // Same reasoning: a 0 baseline would anchor prices at zero. Absent means
        // "price off live GDP", which is what `militaryPriceAnchor` does with null.
        militaryPriceBaselineGdp: budget?.militaryPriceBaselineGdp ?? null,
        appropriation: appropriationPot.balance,
        appropriationAccrual: accrualPerTurn(defenceLine),
        appropriationUpkeep: upkeepPerTurn(
          forceAgg.totalUpkeep,
          seedRosterUpkeepFor(gameState?.preset ?? DEFAULT_SEED_PRESET, countryId),
          defenceLine
        ),
        arrearsRatio: appropriationPot.arrearsRatio,
        hasBudget: budget != null,
        tier,
      };
      // The national materiel store and the contracts filling it. Serialised for the client
      // with `_id` as a string, matching how `units` is handed over above.
      arsenal = await getNationalArsenal(db, countryId);
      // Open, not just active: an offer the supplier has not answered is exactly what the
      // minister needs to see — otherwise an awarded contract vanishes until it is accepted.
      const activeContracts = await listOpenContracts(db, countryId);
      const supplierIds = [...new Set(activeContracts.map((c) => c.corporationId.toString()))];
      const supplierNames = new Map<string, string>();
      if (supplierIds.length > 0) {
        const corps = await db
          .collection<{ _id: ObjectId; name?: string }>("corporations")
          .find({ _id: { $in: supplierIds.map((id) => new ObjectId(id)) } })
          .project({ _id: 1, name: 1 })
          .toArray();
        for (const c of corps) supplierNames.set(c._id.toString(), c.name ?? "Unknown supplier");
      }
      contracts = activeContracts.map((c) => ({
        _id: c._id.toString(),
        corporationId: c.corporationId.toString(),
        sectorId: c.sectorId.toString(),
        supplierName: supplierNames.get(c.corporationId.toString()) ?? "Unknown supplier",
        component: c.component,
        lotsOrdered: c.lotsOrdered,
        lotsDelivered: c.lotsDelivered,
        pricePerLot: c.pricePerLot,
        awardedTurn: c.awardedTurn,
        status: c.status,
      }));

      // The award form needs both halves: who can build, and what a lot costs. The price is
      // computed the same way the award route computes it, off the same anchored GDP, so the
      // quote the minister approves is the price they are actually billed.
      suppliers = await listDefenceSuppliers(db, countryId, liveYear ?? 0);
      lotPricePerLot = lotPrice(
        countryId,
        militaryPriceAnchor(budget?.gdp, budget?.militaryPriceBaselineGdp)
      );

      const year = liveYear;
      const startYear = gameState?.startingYear;
      doctrine =
        year != null && startYear != null
          ? await settleDoctrineIncome(db, countryId, startYear, year)
          : await getNationalDoctrine(db, countryId);
      doctrineEra = await resolveDoctrineEra(db);
      commands = await getMilitaryCommands(db, countryId);
      commanders = await listCountryGenerals(db, countryId);
      conflictAssignments = (await getMilitaryFormations(db, countryId)).conflictAssignments;
      // The SecDef's personnel view: the corps (incl. unspecced + dismissed) and who
      // they could still commission.
      [corps, commissionCandidates] = await Promise.all([
        listCountryCorps(db, countryId),
        listCommissionCandidates(db, countryId),
      ]);

      // Live, viewer-relative region threat from active W6 conflicts.
      const [pendingDecls, recentReports, theaterStates, activeConflicts, blocs] =
        await Promise.all([
          listPendingDeclarations(db),
          listRecentBattleReports(db, currentTurn - 24),
          listTheaterStates(db),
          listActiveConflicts(db),
          loadMilitaryBlocs(db),
        ]);
      // conflictId → strategic region, so a conflict's activity heats its region.
      const theaterRegion: Record<string, string> = {};
      for (const c of activeConflicts) theaterRegion[c._id] = c.region;
      regionThreats = computeRegionThreats({
        viewerCountry: countryId,
        blocs,
        viewerHomeRegion: homeRegionOf(countryId),
        currentTurn,
        theaterRegion,
        declarations: pendingDecls.map((d) => ({
          declarerCountry: d.declarerCountry,
          targetCountry: d.targetCountry,
          theaterId: d.theaterId,
        })),
        reports: recentReports.map((r) => ({
          declarerCountry: r.declarerCountry,
          targetCountry: r.targetCountry,
          attackers: r.attackers,
          defenders: r.defenders,
          theaterId: r.theaterId,
          turn: r.turn,
          noContact: r.noContact,
        })),
        committedByCountry: theaterStates.map((s) => ({
          country: s.countryId,
          committed: s.committed,
        })),
      });

      // Replacement manpower: the pool, what it regenerates to, and the stance in force
      // (law-driven for playables). Mirrors applyReinforcement's own arithmetic so the
      // panel can never disagree with what the turn step actually does.
      const [manpowerState, stance] = await Promise.all([
        getNationalManpower(db, countryId),
        resolveConscriptionStanceFor(db, countryId),
      ]);
      const population = countryStates.reduce(
        (a, s) => a + ((s as { population?: number }).population ?? 0),
        0
      );
      manpower = {
        pool: manpowerState.pool,
        mode: manpowerState.mode,
        regenPerTurn: Math.floor(population * ATTRITION.manpowerRegenFraction * stance.poolMult),
        // Shared helper, not a third copy of the formula: what the player sees as
        // poolCap and the ceiling procurement enforces must not drift apart.
        poolCap: manpowerCeiling(population, stance.poolMult),
        stanceLabel: stance.label,
        conscriptAllowed: stance.conscriptAllowed,
      };
    }

    // Estates seat: attach the portfolio roster + aggregate.
    let estates: Record<string, unknown>[] | undefined;
    let estateSummary: Record<string, unknown> | undefined;
    const estatePortfolio = resolveEstatePortfolio(countryId, positionId);
    if (estatePortfolio) {
      const rawEstates = await getCabinetEstatesCollection(db)
        .find({ countryId, positionId })
        .toArray();
      estates = rawEstates.map((e) => ({
        ...e,
        _id: String(e._id),
        effectiveOutput: computeEstateOutput(e),
        effectiveUpkeep: computeEstateUpkeep(e),
      }));
      const envelope = await resolvePortfolioEnvelope(db, countryId, estatePortfolio);
      const agg = aggregateEstates(rawEstates);
      estateSummary = {
        count: agg.count,
        totalUpkeep: agg.totalUpkeep,
        bySite: agg.bySite,
        envelope,
        portfolioKey: estatePortfolio,
      };
    }

    // Energy seat: attach the plant fleet + national mix aggregate.
    let plants: Record<string, unknown>[] | undefined;
    let energySummary: Record<string, unknown> | undefined;
    if (resolveEnergyPosition(countryId, positionId)) {
      const rawPlants = await getEnergyPlantsCollection(db)
        .find({ countryId, positionId })
        .toArray();
      plants = rawPlants.map((p) => ({
        ...p,
        _id: String(p._id),
        effectiveCapacity: energyEffectiveCapacity(p),
        effectiveUpkeep: energyEffectiveUpkeep(p),
      }));
      const energyEnvelope = await resolveEnergyEnvelope(db, countryId);
      const mix = aggregateMix(rawPlants);
      const byRegion: Record<string, Record<string, number>> = {};
      for (const p of rawPlants) {
        (byRegion[p.regionId] ??= {})[p.source] =
          (byRegion[p.regionId][p.source] ?? 0) + energyEffectiveCapacity(p);
      }
      energySummary = { ...mix, envelope: energyEnvelope, byRegion };
    }

    // Transportation seat: attach the project pipeline + aggregate.
    let projects: Record<string, unknown>[] | undefined;
    let infraSummary: Record<string, unknown> | undefined;
    if (resolveInfraPosition(countryId, positionId)) {
      const rawProjects = await getInfraProjectsCollection(db)
        .find({ countryId, positionId })
        .toArray();
      projects = rawProjects.map((p) => ({
        ...p,
        _id: String(p._id),
        effectiveOutput: infraEffectiveOutput(p),
        effectiveUpkeep:
          p.status === "operational"
            ? p.upkeepBase
            : +(p.constructionCostBase * buildFundingDef(p.fundingLevel).costMult).toFixed(4),
        progressPct: progressPct(p),
        turnsRemaining: turnsRemaining(p),
      }));
      const infraEnvelope = await resolveInfraEnvelope(db, countryId);
      infraSummary = { ...aggregateInfra(rawProjects), envelope: infraEnvelope };
    }

    // Finance seat: assemble the read-only monetary dossier + the debt-op state.
    // The prime rate / FX band belong to the Central Bank (read-only here); the
    // movable component is the sovereign confidence premium.
    let monetary:
      | {
          primeRate: number | null;
          primeRateHistory: { turn: number; rate: number }[];
          chairName: string | null;
          sovereignRate: number | null;
          confidencePremium: number;
          investorConfidence: number | null;
          confidenceBaseline: number;
          fxRate: number | null;
          fxBand: { floor: number; ceiling: number } | null;
          reserveBalance: number | null;
          forexRevenue: number | null;
          debtOp: {
            active: boolean;
            expiresTurn: number | null;
            cooldownUntilTurn: number;
            boostPerTurn: number | null;
          };
        }
      | undefined;
    if (resolveFinancePosition(countryId) === positionId) {
      // `bank` may be null above when no nationalMetric needs it — fetch for finance.
      const financeBank =
        bank ??
        (await db.collection<CentralBank>("centralBanks").findOne({ _id: getBankId(countryId) }));
      const [fx, opDoc] = await Promise.all([
        db.collection<ExchangeRate>("exchangeRates").findOne({ _id: countryId }),
        getTreasuryOperationsCollection(db).findOne({ _id: countryId }),
      ]);
      const confidence = budget?.investorConfidence ?? null;
      monetary = {
        primeRate: financeBank?.primeRate ?? null,
        primeRateHistory: financeBank?.interestRateHistory ?? [],
        chairName: financeBank?.chairCharacterName ?? null,
        sovereignRate: budget?.debt?.interestRate ?? null,
        confidencePremium: getSovereignConfidencePremium(confidence),
        investorConfidence: confidence,
        confidenceBaseline: INVESTOR_CONFIDENCE_BASELINE,
        fxRate: fx?.rate ?? null,
        fxBand: fx?.interventionPolicy
          ? { floor: fx.interventionPolicy.floor, ceiling: fx.interventionPolicy.ceiling }
          : null,
        reserveBalance: financeBank?.reserveBalance ?? null,
        forexRevenue: financeBank?.forexRevenue ?? null,
        debtOp: opDoc?.activeOp
          ? {
              active: true,
              expiresTurn: opDoc.activeOp.expiresTurn,
              cooldownUntilTurn: opDoc.cooldownUntilTurn,
              boostPerTurn: opDoc.activeOp.boostPerTurn,
            }
          : {
              active: false,
              expiresTurn: null,
              cooldownUntilTurn: opDoc?.cooldownUntilTurn ?? 0,
              boostPerTurn: null,
            },
      };
    }

    return NextResponse.json({
      // Gates the Treasury-tab "Fund Geological Survey" action (per-surface flag
      // convention: the office page reads its own briefing GET).
      prospectingEnabled: await isProspectingEnabled(),
      // Live in-game year (null = era-awareness unavailable). Client-side
      // roster chrome (e.g. the position rail) filters with this via the pure
      // rosterEra helpers.
      liveYear,
      position: {
        id: mechanics.positionId,
        name: positionDef ? resolveSeatName(positionDef, liveYear) : null,
        department: resolveDepartment(mechanics, liveYear),
        sealImage: mechanics.sealImage ?? null,
        singleRegionFocus: mechanics.singleRegionFocus ?? null,
      },
      mechanics: {
        tierSetting: mechanics.tierSetting ?? null,
        tierSettings: mechanics.tierSettings ?? null,
        regionalTarget: mechanics.regionalTarget ?? null,
        allocation: mechanics.allocation ?? null,
        advocacy: mechanics.advocacy ?? null,
        emergency: mechanics.emergency ?? null,
      },
      orders: getMinisterialOrders(countryId, positionId),
      member: member
        ? {
            characterId: member.characterId?.toString() ?? null,
            isNPP: member.isNPP ?? false,
            nppId: member.nppId?.toString() ?? null,
            sequentialId: holderChar?.sequentialId ?? null,
            characterName: member.characterName,
            avatarUrl: holderChar?.avatarUrl ?? null,
            borderKey: holderChar?.borderKey ?? null,
            tintColor: holderChar?.tintColor ?? null,
            party: member.party ?? null,
            partyName: partyDoc?.name ?? null,
            partyColor: partyDoc?.color ?? null,
            partyLogoUrl: partyDoc?.logoUrl ?? null,
            ministerialActions: member.ministerialActions ?? 2,
            bannerImageUrl: member.bannerImageUrl ?? null,
          }
        : null,
      currentSettings: setting
        ? {
            tierSetting: setting.tierSetting ?? null,
            tierSettings: setting.tierSettings ?? null,
            targetRegionId: setting.targetRegionId ?? null,
            targetCountryId: setting.targetCountryId ?? null,
            aidPriority: setting.aidPriority ?? null,
            advocacyActive: setting.advocacyActive ?? false,
            allocationPercents: setting.allocationPercents ?? null,
            lastChangedTurn: setting.lastChangedTurn,
          }
        : null,
      activeOrders: activeOrders.map((o) => ({
        orderId: o.orderId,
        orderName: o.orderName,
        issuedTurn: o.issuedTurn,
        expiresTurn: o.expiresTurn,
        effects: o.effects,
      })),
      currentTurn,
      targetCountries: enabledCountryIds
        .filter((enabledCountryId) => enabledCountryId !== countryId)
        .map((enabledCountryId) => ({
          id: enabledCountryId,
          label: COUNTRY_CONFIGS[enabledCountryId].name,
        })),
      nationalMetrics,
      regionData,
      regionalBudgets: regionalBudgets.map((rb) => ({
        regionId: rb._id,
        fundingPoolAmount:
          countryId === COUNTRY_CONFIGS.JP.id
            ? (rb.nationalGrant ?? 0)
            : countryId === COUNTRY_CONFIGS.DE.id
              ? (rb.federalEqualizationGrant ?? 0)
              : countryId === COUNTRY_CONFIGS.CN.id
                ? (rb.centralTransferGrant ?? 0)
                : (rb.westminsterGrant ?? 0),
        westminsterGrant: rb.westminsterGrant ?? 0,
        nationalGrant: rb.nationalGrant ?? 0,
        federalEqualizationGrant: rb.federalEqualizationGrant ?? 0,
        totalBudget: rb.totalBudget ?? 0,
        propertyValuePerCapita: rb.propertyValuePerCapita ?? 0,
        commercialValuePerCapita: rb.commercialValuePerCapita ?? 0,
        chancellorAllocationPercent: null,
      })),
      sovereignBondProfile: budget?.sovereignBondProfile ?? null,
      debtPrincipal: budget?.debt?.principal ?? 0,
      sovereignBondsOutstanding: sovereignBonds.reduce((sum, b) => sum + (b.totalIssued ?? 0), 0),
      canAct,
      units,
      forceSummary,
      doctrine,
      doctrineEra,
      commands,
      commanders,
      conflictAssignments,
      corps,
      commissionCandidates,
      regionThreats,
      manpower,
      arsenal,
      contracts,
      suppliers,
      lotPricePerLot,
      estates,
      estateSummary,
      plants,
      energySummary,
      projects,
      infraSummary,
      monetary,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

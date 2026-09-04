import type { Db, ObjectId } from "mongodb";
import type {
  FederalBudget,
  EnactedLaw,
  FederalBudgetSnapshot,
  CreditRating,
  SovereignCrisisState,
} from "@/lib/db/types/budget";
import { assertTreasuryAuthority } from "@/lib/nationalization/authority";
import type { StateBudget } from "@/lib/db/types/budget";
import type { State } from "@/lib/db/types/state";
import type { RegionalBudget } from "@/lib/db/types/regionalBudget";
import { regionalGrantAmount } from "@/lib/budget/regionalGrantField";
import type { CentralBank, GameConfig, GameState } from "@/lib/db/types";
import { COUNTRY_CONFIGS, isParliamentarySystem, type CountryId } from "@/lib/constants/countries";
import { calculateFederalRevenue, loadLatestSourcedImportAggregates } from "@/lib/budget/revenue";
import { loadFxRatesByCurrency } from "@/lib/currency/corporationCapital";
import { FISCAL_YEAR_START_TURN_IN_YEAR, calculateFiscalYear } from "@/lib/budget/fiscalYear";
import { normalizeFederalSpending } from "@/lib/budget/spending";
import { federalSurplus } from "@/lib/budget/federalSurplus";
import { liveNationalGdpUnits } from "@/lib/budget/gdpDenominator";
import { TURNS_PER_YEAR, STARTING_YEAR } from "@/lib/constants/turnTime";
import { formulaGrants } from "@/lib/seeds/reference/formulaGrants";
import { resolveCountryCurrencyCode } from "@/lib/currency/govBudgetFields";
import { estimateCountryOwnedBudgetNetLocal } from "@/lib/budget/publicEnterpriseRevenue";
import { readStateOwnershipConcentration } from "@/lib/nationalization/concentration";
import { nationalLawCountryQuery } from "@/lib/policy/nationalPolicyRecords";
import { effectiveBorrowingLimit } from "@/lib/budget/borrowingLimit";
import { loadDefenseFunding } from "./defenseFunding";
import { getGameStatePresetOrDefault } from "@/lib/db/collections/gameState";

/** One point on the fiscal-year trend series (stat strip compare + debt sparkline). */
export interface FyHistoryPoint {
  fy: number;
  revenue: number;
  spending: number;
  debtToGdp: number;
  gdp: number;
  rating: CreditRating;
}

type FyHistorySnap = {
  fiscalYear: number;
  budget: {
    revenue: { total: number };
    spending: { total: number };
    debtToGdpRatio: number;
    gdp: number;
    creditRating: CreditRating;
  };
};

type FyHistoryLive = {
  fiscalYear: number;
  revenue: { total: number };
  spending: { total: number };
  debtToGdpRatio: number;
  gdp: number;
  creditRating: CreditRating;
};

/**
 * Assemble the ascending FY trend series from frozen snapshots plus the live
 * resolved budget. The live year overrides any same-FY snapshot (the live
 * accounts are authoritative), so a trend never double-counts the current year.
 */
export function buildFyHistory(
  snaps: FyHistorySnap[],
  live: FyHistoryLive | null
): FyHistoryPoint[] {
  const byFy = new Map<number, FyHistoryPoint>();
  for (const s of snaps) {
    byFy.set(s.fiscalYear, {
      fy: s.fiscalYear,
      revenue: s.budget.revenue.total,
      spending: s.budget.spending.total,
      debtToGdp: s.budget.debtToGdpRatio,
      gdp: s.budget.gdp,
      rating: s.budget.creditRating,
    });
  }
  if (live) {
    byFy.set(live.fiscalYear, {
      fy: live.fiscalYear,
      revenue: live.revenue.total,
      spending: live.spending.total,
      debtToGdp: live.debtToGdpRatio,
      gdp: live.gdp,
      rating: live.creditRating,
    });
  }
  return [...byFy.values()].sort((a, b) => a.fy - b.fy);
}

/** Live sovereign-health signals for the Sovereign Health panel (read-only). */
export interface SovereignProjection {
  state: SovereignCrisisState;
  demandRatio: number | null;
  failedAuctions: number;
  marketAccess: "Open" | "Locked";
  marketAccessUntilTurn: number | null;
}

/**
 * Project the budget's live sovereign-default signals into the read shape the
 * Sovereign Health panel consumes. Absent fields default to a healthy "normal /
 * Open" posture (pre-migration / un-stressed countries).
 */
export function projectSovereign(
  budget: Pick<
    FederalBudget,
    | "sovereignCrisisState"
    | "lastAuctionDemandRatio"
    | "failedAuctionConsecutiveCount"
    | "marketAccessLockedUntilTurn"
  >,
  currentTurn: number
): SovereignProjection {
  const lockUntil = budget.marketAccessLockedUntilTurn ?? null;
  const locked = lockUntil != null && lockUntil > currentTurn;
  return {
    state: budget.sovereignCrisisState ?? "normal",
    demandRatio: budget.lastAuctionDemandRatio ?? null,
    failedAuctions: budget.failedAuctionConsecutiveCount ?? 0,
    marketAccess: locked ? "Locked" : "Open",
    marketAccessUntilTurn: locked ? lockUntil : null,
  };
}

export async function loadFederalBudgetDetail(params: {
  db: Db;
  countryId: CountryId;
  requestUrl: string;
  /**
   * Acting viewer's character id (for the Finance-Minister lens gate). When the
   * seated finance-minister-equivalent of this country, the response sets
   * `isFinanceMinister: true`. Omit for unauthenticated / character-less reads.
   */
  characterId?: ObjectId;
}) {
  const { db, countryId, requestUrl, characterId } = params;
  const budgetId = countryId === COUNTRY_CONFIGS.US.id ? "federal" : countryId;
  const budgetCountryId = countryId;
  const grantLabel = COUNTRY_CONFIGS[budgetCountryId].centralGovernmentLabel;
  const grantRecipientLabel =
    budgetCountryId === COUNTRY_CONFIGS.UK.id
      ? "Nation / Region"
      : budgetCountryId === COUNTRY_CONFIGS.DE.id
        ? "Land"
        : budgetCountryId === COUNTRY_CONFIGS.CN.id
          ? "Macro-Region"
          : COUNTRY_CONFIGS[budgetCountryId].regionLabel;

  const snapshotDocs = await db
    .collection<FederalBudgetSnapshot>("federalBudgetSnapshots")
    .find(
      { countryId },
      {
        projection: {
          fiscalYear: 1,
          "budget.revenue.total": 1,
          "budget.spending.total": 1,
          "budget.debtToGdpRatio": 1,
          "budget.gdp": 1,
          "budget.creditRating": 1,
        },
      }
    )
    .toArray();
  const availableFiscalYears = snapshotDocs.map((s) => s.fiscalYear).sort((a, b) => b - a);
  const fyHistorySnaps = snapshotDocs as unknown as FyHistorySnap[];

  const { searchParams } = new URL(requestUrl);
  const rawFiscalYear = searchParams.get("fiscalYear");
  const requestedFY = rawFiscalYear ? parseInt(rawFiscalYear, 10) : null;

  if (requestedFY && !Number.isNaN(requestedFY)) {
    const snapshot = await db
      .collection<FederalBudgetSnapshot>("federalBudgetSnapshots")
      .findOne({ _id: `${countryId}:FY${requestedFY}` });
    if (!snapshot) return { ok: false as const, status: 404, error: "Snapshot not found" };

    const [snapshotGameState, snapshotGameConfig] = await Promise.all([
      db
        .collection<GameState>("gameState")
        .findOne({ _id: "current" }, { projection: { currentYear: 1 } }),
      db
        .collection<GameConfig>("gameConfig")
        .findOne({ _id: "default" }, { projection: { commandEconomyEnabled: 1 } }),
    ]);

    const snapshotCurrencyCode =
      snapshot.budget.currencyCode ?? resolveCountryCurrencyCode({ countryId: snapshot.countryId });
    return {
      ok: true as const,
      body: {
        budget: {
          ...snapshot.budget,
          _id: budgetId,
          countryId: snapshot.countryId,
          fiscalYear: snapshot.fiscalYear,
          updatedAt: snapshot.createdAt,
        },
        currencyCode: snapshotCurrencyCode,
        primeRate: 0,
        turnsUntilFY: 0,
        stateGrantBreakdown: snapshot.stateGrants.map((g) => ({
          stateId: g.stateId,
          stateName: g.stateName,
          federalGrants: g.amount,
        })),
        enactedLaws: snapshot.enactedLaws,
        grantLabel,
        grantRecipientLabel,
        formulaGrants: [],
        isSnapshot: true,
        snapshotFiscalYear: snapshot.fiscalYear,
        availableFiscalYears,
        fyHistory: buildFyHistory(fyHistorySnaps, null),
        // Historical view: the sovereign state machine is a live-only concept,
        // and the minister lens is not offered on a frozen snapshot.
        sovereign: projectSovereign({}, 0),
        isFinanceMinister: false,
        // Regime banding for the Planned Economy panel (year ≈ FY on snapshots).
        currentYear: snapshot.fiscalYear ?? snapshotGameState?.currentYear ?? null,
        commandEconomyEnabled: snapshotGameConfig?.commandEconomyEnabled === true,
      },
    };
  }

  const [storedNationalBudgetDoc, gameState, centralBank, gameConfig] = await Promise.all([
    db.collection<FederalBudget>("federalBudget").findOne({ _id: budgetId }),
    db
      .collection<GameState>("gameState")
      .findOne(
        { _id: "current" },
        { projection: { currentTurn: 1, currentYear: 1, startingYear: 1 } }
      ),
    db
      .collection<CentralBank>("centralBanks")
      .findOne(
        COUNTRY_CONFIGS[countryId].centralBank.sharedBankId
          ? { _id: COUNTRY_CONFIGS[countryId].centralBank.sharedBankId }
          : { countryId },
        { projection: { primeRate: 1, reserveBalance: 1 } }
      ),
    db
      .collection<GameConfig>("gameConfig")
      .findOne(
        { _id: "default" },
        { projection: { commandEconomyEnabled: 1, interstateMoneyWiringEnabled: 1 } }
      ),
  ]);

  let storedNationalBudget = storedNationalBudgetDoc;
  let usingSeedFallback = false;
  if (!storedNationalBudget) {
    const { initialNationalBudgets } = await import("@/lib/seeds/reference/budgets");
    const fallbackBudget = initialNationalBudgets.find((budget) => budget.countryId === countryId);
    if (fallbackBudget) {
      storedNationalBudget = {
        ...fallbackBudget,
        updatedAt: new Date(),
      } as FederalBudget;
      usingSeedFallback = true;
    }
  }
  if (!storedNationalBudget) {
    return { ok: false as const, status: 404, error: "National budget not found" };
  }

  const borrowingLimit = effectiveBorrowingLimit({
    countryId: budgetCountryId,
    gdp: storedNationalBudget.gdpSmoothed ?? storedNationalBudget.gdp,
    storedCeiling: storedNationalBudget.debt?.ceiling ?? 0,
  });
  storedNationalBudget = {
    ...storedNationalBudget,
    debt: { ...storedNationalBudget.debt, ceiling: borrowingLimit },
  };

  const currentTurn = gameState?.currentTurn ?? 0;
  const turnInYear = ((currentTurn - 1) % TURNS_PER_YEAR) + 1;
  const rawTurnsUntilFY = FISCAL_YEAR_START_TURN_IN_YEAR - turnInYear;
  const turnsUntilFY = rawTurnsUntilFY <= 0 ? rawTurnsUntilFY + TURNS_PER_YEAR : rawTurnsUntilFY;

  // Preset-aware calendar year. Prefer the engine-maintained `currentYear`
  // (the SSOT updated every turn); fall back to the world's `startingYear`
  // (1991 / 2019 / …) plus elapsed game-years, then the global `STARTING_YEAR`
  // for legacy rows predating both fields. The old code used `STARTING_YEAR`
  // unconditionally, so a 1991 world's budget header showed 2019-based years.
  const startingYear = gameState?.startingYear ?? STARTING_YEAR;
  const currentYear =
    gameState?.currentYear ?? startingYear + Math.floor((currentTurn - 1) / TURNS_PER_YEAR);
  const liveFiscalYear = calculateFiscalYear(currentYear, currentTurn);

  let resolvedNationalBudget: FederalBudget;
  if (usingSeedFallback) {
    const spending = normalizeFederalSpending(storedNationalBudget.spending);
    resolvedNationalBudget = {
      ...storedNationalBudget,
      fiscalYear: liveFiscalYear,
      spending,
      surplus: federalSurplus({ revenue: storedNationalBudget.revenue, spending }),
    };
  } else {
    // Money wiring (interstate-logistics plan step 5, phase B): mirror the
    // persisted-budget netting here too, so a page load between turns shows
    // the same tariff figure `refreshNationalBudgetRevenue` last wrote,
    // instead of silently reverting to the un-netted GDP proxy on every read.
    let sourcedImports: { tariffPaidAnchor: number; importValueAnchor: number } | undefined;
    if (gameConfig?.interstateMoneyWiringEnabled === true) {
      const sourcedByCountry = await loadLatestSourcedImportAggregates(db, currentTurn);
      const agg = sourcedByCountry.get(countryId);
      if (agg) {
        sourcedImports = { tariffPaidAnchor: agg.tariffPaid, importValueAnchor: agg.importValue };
      }
    }
    const fxByCurrency = sourcedImports ? await loadFxRatesByCurrency(db) : undefined;
    const recalculatedRevenue = await calculateFederalRevenue(
      db,
      storedNationalBudget.taxRates,
      budgetId,
      undefined,
      undefined,
      undefined,
      fxByCurrency,
      sourcedImports
    );
    const spending = normalizeFederalSpending(storedNationalBudget.spending);
    resolvedNationalBudget = {
      ...storedNationalBudget,
      fiscalYear: liveFiscalYear,
      revenue: recalculatedRevenue,
      spending,
      surplus: federalSurplus({ revenue: recalculatedRevenue, spending }),
    };
  }

  const states = await db
    .collection<State>("states")
    .find({ countryId: budgetCountryId })
    .toArray();
  // A1 SSOT: national GDP is the live sum of regional gdp, not the fiscal-close
  // snapshot in `budget.gdp`, which runs up to 6.5% behind between rollovers.
  // See lib/budget/gdpDenominator.
  const liveGdpUnits = liveNationalGdpUnits(states);
  const stateIds = states.map((state) => state._id);
  const [stateBudgets, regionalBudgets] = await Promise.all([
    db
      .collection<StateBudget>("stateBudgets")
      .find({ stateId: { $in: stateIds } })
      .toArray(),
    isParliamentarySystem(COUNTRY_CONFIGS[budgetCountryId])
      ? db
          .collection<RegionalBudget>("regionalBudgets")
          .find({ _id: { $in: stateIds } })
          .toArray()
      : Promise.resolve([] as RegionalBudget[]),
  ]);
  const stateBudgetMap = new Map(stateBudgets.map((budget) => [budget.stateId, budget]));
  const regionalBudgetMap = new Map(regionalBudgets.map((budget) => [budget._id, budget]));

  const stateGrantBreakdown = states
    .map((state) => {
      const regionalBudget = regionalBudgetMap.get(state._id);
      const stateBudget = stateBudgetMap.get(state._id);
      // Table lookup, not an if/else chain with a default: the chain this
      // replaced ended in `westminsterGrant`, so any country it did not name
      // read the UK's field and reported DDM 0 instead of failing. DD lost its
      // Länder grants that way (#1323). `undefined` here means "no grant field
      // mapped for this country", which falls back to the stateBudgets figure
      // exactly as a missing regionalBudget does.
      const federalGrants =
        regionalGrantAmount(budgetCountryId, regionalBudget) ??
        stateBudget?.revenue?.federalGrants ??
        0;
      return {
        stateId: state._id,
        stateName: state.name,
        federalGrants,
      };
    })
    .sort((a, b) => b.federalGrants - a.federalGrants);

  const enactedLawQuery: Record<string, unknown> = {
    scope: "national",
    ...nationalLawCountryQuery(budgetCountryId),
    repealedAt: { $exists: false },
  };
  const enactedLaws = await db
    .collection<EnactedLaw>("enactedLaws")
    .find(enactedLawQuery)
    .toArray();

  // Enrich tax statutes with the revenue line they govern: a tax law's
  // legislationType carries `taxRateChange.taxType`, which is a FederalTaxRates /
  // revenue key (e.g. "domesticCorporateTax"). Lets the budget UI file each
  // statutory tax law under its revenue line instead of a phantom "tax" bucket.
  const legislationTypeIds = Array.from(
    new Set(enactedLaws.map((l) => l.legislationTypeId).filter((id): id is string => !!id))
  );
  const revenueTaxTypeByLegId = new Map<string, string>();
  if (legislationTypeIds.length > 0) {
    const legislationTypes = await db
      .collection<{ _id: string; taxRateChange?: { taxType?: string } }>("legislationTypes")
      .find({ _id: { $in: legislationTypeIds } }, { projection: { "taxRateChange.taxType": 1 } })
      .toArray();
    for (const t of legislationTypes) {
      if (t.taxRateChange?.taxType) revenueTaxTypeByLegId.set(t._id, t.taxRateChange.taxType);
    }
  }
  const enrichedLaws = enactedLaws.map((law) => {
    const revenueTaxType = law.legislationTypeId
      ? revenueTaxTypeByLegId.get(law.legislationTypeId)
      : undefined;
    return revenueTaxType ? { ...law, revenueTaxType } : law;
  });

  // Signed per-turn State-enterprise (National Corporation) net, in local
  // currency, for the budget's revenue/expenditure State Enterprises line.
  const stateEnterpriseNet = await estimateCountryOwnedBudgetNetLocal(db, budgetCountryId);
  // State Ownership Concentration Index (SOCI, 0–100) for the State Enterprises card.
  const stateOwnershipConcentration = await readStateOwnershipConcentration(db, budgetCountryId);

  // Defence funding position (live budgets only): the enacted line the
  // surplus tile counts vs the force's actual upkeep, plus the appropriation
  // pot. Upkeep beyond the line leaves the treasury as debt without touching
  // any spending row, which is the usual reason a balance falls under a
  // surplus (ticket #1269). Read-only; the turn phase stays the sole writer.
  const defenseFunding = await loadDefenseFunding(
    db,
    budgetCountryId,
    storedNationalBudget,
    await getGameStatePresetOrDefault(db)
  );

  // Finance-Minister lens gate: only the seated finance-minister-equivalent (or
  // head of government when the seat is vacant) sees the confidential lens.
  const isFinanceMinister = characterId
    ? await assertTreasuryAuthority(db, budgetCountryId, characterId)
    : false;

  return {
    ok: true as const,
    body: {
      budget: resolvedNationalBudget,
      stateEnterpriseNet,
      stateOwnershipConcentration,
      defenseFunding,
      // Signed national treasury balance (local currency) — the unified fiscal +
      // nationalization cash position. Positive = surplus, negative = national
      // debt. Pre-migration docs fall back to −debt.principal.
      treasuryReserve:
        resolvedNationalBudget.treasuryBalance ?? -(resolvedNationalBudget.debt?.principal ?? 0),
      /** Live national GDP in base currency units, summed from every region this
       *  turn. Prefer this over `budget.gdp` for display. */
      liveGdpUnits,
      currencyCode:
        resolvedNationalBudget.currencyCode ??
        resolveCountryCurrencyCode({ countryId: budgetCountryId }),
      primeRate: centralBank?.primeRate ?? 0,
      turnsUntilFY,
      stateGrantBreakdown,
      enactedLaws: enrichedLaws,
      grantLabel,
      grantRecipientLabel,
      formulaGrants: budgetCountryId === COUNTRY_CONFIGS.US.id ? formulaGrants : [],
      isSnapshot: false,
      availableFiscalYears,
      // FY trend series (stat-strip compare + debt sparkline): snapshots + the
      // live year (which overrides any same-FY snapshot).
      fyHistory: buildFyHistory(fyHistorySnaps, resolvedNationalBudget),
      // Live sovereign-default signals for the Sovereign Health panel.
      sovereign: projectSovereign(resolvedNationalBudget, currentTurn),
      isFinanceMinister,
      currentYear,
      commandEconomyEnabled: gameConfig?.commandEconomyEnabled === true,
    },
  };
}

/** Projected per-turn observations for a sector investment balance experiment. */
import type { Db } from "mongodb";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { EXTRACTABLE_RESOURCES } from "@/lib/constants/commodities";
import { SECTOR_STRATEGIES } from "@/lib/constants/sectorStrategies";
import type { GameConfig } from "@/lib/db/types/gameConfig";
import type { GameState } from "@/lib/db/types/gameState";
import { isMarketSystemMode, marketAtLeast } from "@/lib/market/featureFlag";

const NPC_CORPORATION_USER_ID = "000000000000000000000000";

export interface InvestmentSnapshotProvenance {
  runId: string;
  seed: string;
  codeVersion: string;
}

export type InvestmentObservationClass = "opening-state" | "post-turn-state";

function qualificationSource(
  db: Pick<Db, "databaseName">,
  provenance?: InvestmentSnapshotProvenance
): { sourceMetadata: InvestmentSnapshotProvenance | null; eligible: boolean } {
  if (provenance === undefined) return { sourceMetadata: null, eligible: false };
  if (
    typeof provenance.runId !== "string" ||
    typeof provenance.seed !== "string" ||
    typeof provenance.codeVersion !== "string" ||
    !provenance.runId.trim() ||
    !provenance.seed.trim() ||
    !/^[\da-f]{40}$/i.test(provenance.codeVersion)
  ) {
    throw new Error(
      "Qualification capture requires nonempty run and seed plus a full 40-character code version"
    );
  }
  if (typeof db.databaseName !== "string" || !/^ahd_sim_[a-zA-Z0-9_-]+$/.test(db.databaseName)) {
    throw new Error("Qualification capture is restricted to an ahd_sim_ sandbox database");
  }
  return { sourceMetadata: provenance, eligible: true };
}

function assertFiniteTree(value: unknown, path: string): void {
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error(`Non-finite simulation input at ${path}`);
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertFiniteTree(entry, `${path}[${index}]`));
  } else if (
    value &&
    typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    for (const [key, entry] of Object.entries(value)) assertFiniteTree(entry, `${path}.${key}`);
  }
}

function idString(value: unknown): string {
  return value && typeof value === "object" && "toString" in value
    ? String(value)
    : String(value ?? "");
}

function projectRow<T extends Record<string, unknown>>(row: T, keys: readonly string[]) {
  return Object.fromEntries(keys.filter((key) => key in row).map((key) => [key, row[key]]));
}

const PASS2_SECTOR_FIELDS = [
  "_id",
  "corporationId",
  "countryId",
  "resolvedCountryId",
  "stateId",
  "strategyId",
  "soldFraction",
  "transitionCooldownUntilTurn",
  "capitalStock",
  "buildQueue",
  "otherOpexPerUnitAnchor",
  "clearingStartTurn",
  "throughputStartTurn",
] as const;
const STRATEGY_COMMODITY_FIELDS = [
  "commodity",
  "globalSupply",
  "globalDemand",
  "stateSupply",
  "globalPrice",
  "basePrice",
  "nationalPrices",
  "reachablePrices",
  "stateInputAvailability",
] as const;

/** Build a bounded world-state observation for descriptive strategy shadows. */
export function buildExtractionStrategyObservation(
  turn: number,
  sectors: Array<Record<string, unknown>>,
  corporations: Array<Record<string, unknown>>,
  prices: Array<Record<string, unknown>>,
  capacities: Array<Record<string, unknown>>,
  config: Record<string, unknown> | null,
  gameState: Record<string, unknown> | null,
  books: { turn: number; books?: Record<string, unknown> } | null,
  observationClass: InvestmentObservationClass = "post-turn-state"
) {
  const strategies = SECTOR_STRATEGIES.extraction ?? [];
  const commoditySet = new Set<string>(EXTRACTABLE_RESOURCES);
  for (const strategy of strategies) {
    for (const commodity of [...Object.keys(strategy.supply), ...Object.keys(strategy.demand)]) {
      commoditySet.add(commodity);
    }
  }
  const eligibleCorporations = corporations.filter(
    (corp) =>
      corp.ceoType === "npp" &&
      idString(corp.userId) === NPC_CORPORATION_USER_ID &&
      !Object.hasOwn(corp, "caretakerCeo") &&
      corp.suspended !== true
  );
  const eligibleIds = new Set(eligibleCorporations.map((corp) => idString(corp._id)));
  const extractionSectors = sectors.filter((sector) => sector.sectorType === "extraction");
  const nppSectors = extractionSectors.filter(
    (sector) =>
      eligibleIds.has(idString(sector.corporationId)) && sector.transitionFromStrategyId == null
  );
  const countryByCorporation = new Map(
    eligibleCorporations.map((corp) => [idString(corp._id), corp.countryId])
  );
  const observedNppSectors = nppSectors.map((sector) => ({
    ...projectRow(sector, PASS2_SECTOR_FIELDS),
    resolvedCountryId: sector.countryId ?? countryByCorporation.get(idString(sector.corporationId)),
  }));
  const states = new Set(nppSectors.map((sector) => idString(sector.stateId)));
  const countries = new Set(observedNppSectors.map((sector) => idString(sector.resolvedCountryId)));
  const relevantPrices = prices.filter((price) => commoditySet.has(String(price.commodity)));
  const relevantBooks: Record<string, unknown> = {};
  for (const country of countries) {
    const countryBooks = books?.books?.[country];
    if (!countryBooks || typeof countryBooks !== "object") continue;
    const byCommodity: Record<string, unknown> = {};
    for (const commodity of commoditySet) {
      if (commodity in countryBooks)
        byCommodity[commodity] = (countryBooks as Record<string, unknown>)[commodity];
    }
    if (Object.keys(byCommodity).length) relevantBooks[country] = byCommodity;
  }
  const result = {
    observationClass,
    observationTurn: turn,
    prospectiveEvaluationTurn: turn + 1,
    observationLimits: [
      "Earlier phases can mutate prices, capacities, config, and sector eligibility before the next strategy invocation.",
      "Pass 1 can retool sectors before pass 2; this snapshot does not preserve the exact pre-pass-2 candidate set.",
      "Use only for descriptive legacy-versus-candidate rankings on this same captured state, not exact historical choices or causal returns.",
    ],
    config: projectRow(config ?? {}, [
      "marketSystemMode",
      "freightSettlementMode",
      "marketGovernorCap",
    ]),
    gameState: projectRow(gameState ?? {}, [
      "currentTurn",
      "extractionAutoStrategyEnabled",
      "lastExtractionAutoStrategyTurn",
      "nppEntryViabilityMode",
    ]),
    strategies: strategies.map((strategy) => ({
      id: strategy.id,
      supply: strategy.supply,
      demand: strategy.demand,
    })),
    eligibleNppCorporations: eligibleCorporations.map((corp) => ({
      _id: corp._id,
      countryId: corp.countryId,
      type: corp.type,
    })),
    nppSectors: observedNppSectors,
    extractionCompetition: extractionSectors.map((sector) => ({
      _id: sector._id,
      countryId: sector.countryId,
      stateId: sector.stateId,
      strategyId: sector.strategyId,
      ownerKind: eligibleIds.has(idString(sector.corporationId)) ? "npp" : "other",
    })),
    commodityPrices: relevantPrices.map((price) => projectRow(price, STRATEGY_COMMODITY_FIELDS)),
    stateResourceCapacity: capacities
      .filter((capacity) => states.has(idString(capacity.stateId)))
      .map((capacity) => projectRow(capacity, ["stateId", "countryId", "resources"])),
    tradeFlowSnapshot: books ? { turn: books.turn, books: relevantBooks } : null,
    tradeFlowSnapshotStatus:
      !isMarketSystemMode(config?.marketSystemMode) ||
      !marketAtLeast(config.marketSystemMode, "clearing") ||
      nppSectors.length === 0
        ? "not-read"
        : books === null
          ? "missing"
          : "captured",
    selector: {
      eligibleCorporationPredicate:
        "ceoType=npp,userId=npp-sentinel,caretakerCeo-absent,suspended!=true",
      sectorPredicate:
        "sectorType=extraction,corporationId-in-eligibleNpp,transitionFromStrategyId-in-[null,undefined]",
      maxPerRun: 3,
      observationTurn: turn,
      prospectiveEvaluationTurn: turn + 1,
      strategyCommodities: [...commoditySet].sort(),
    },
  };
  assertFiniteTree(result, "extractionStrategyInputs");
  return result;
}

/** Completed turns clear live telemetry; validate the durable turn log instead. */
export function assertInvestmentTurnComplete(
  turn: number,
  stateTurn: number | undefined,
  log: {
    turn: number;
    phaseStatuses?: Record<string, { status: string }>;
  } | null
): void {
  const phases = Object.entries(log?.phaseStatuses ?? {});
  const failed = phases.filter(([, phase]) => !["completed", "skipped"].includes(phase.status));
  if (stateTurn !== turn || log?.turn !== turn || phases.length === 0 || failed.length > 0) {
    throw new Error(
      `Invalid balance turn ${turn}: ${failed.map(([name]) => name).join(", ") || "missing completed-turn evidence"}`
    );
  }
}

export async function snapshotSectorInvestment(
  db: Db,
  directory: string,
  turn: number,
  provenance?: InvestmentSnapshotProvenance,
  observationClass: InvestmentObservationClass = "post-turn-state"
) {
  const qualification = qualificationSource(db, provenance);
  if (!Number.isSafeInteger(turn) || turn < 0) {
    throw new Error("Investment observation requires a nonnegative safe-integer turn");
  }
  const fields: Record<string, string> = {
    corporateSectors:
      "_id corporationId countryId stateId sectorType strategyId transitionFromStrategyId transitionStartTurn transitionCooldownUntilTurn retoolRescaleApplied otherOpexPerUnitAnchor otherOpexAnchorMarginBasis plantsStartTurn capitalStock operatingCapacityUnits operatingCapacityTurn capacityBookAnchor constructionInProgressAnchor buildQueue plantsPnl producedUnits soldUnits soldByCommodity soldFraction throughputFactor deliveryLimitedFraction workers workersDesired labourStaffingFactor mothballed activeCapacityPercent revenue realizedRevenue plantsUpkeepMarginBasisAnchor clearingStartTurn throughputStartTurn",
    corporations:
      "_id countryId type ceoId ceoType userId caretakerCeo suspended ceoVacant countryOwnerId isNationalized liquidCapital liquidCurrencyCode marketingBudget logisticsBudget rdBudget ceoSalary",
    corporationHistory:
      "_id corporationId turn currencyCode fxRateAtWrite revenue totalCosts income incomePreDividends corporateTaxPaid perTurnBondCouponIncome perTurnBondInterestExpense perTurnBondDragOnNetIncome dividendPaidPerTurn dividendIncomeReceived federalTaxPaid stateTaxPaid taxPaidByCountry taxPaidByState marketCap liquidCapital shareEscrowBalance",
    exchangeRates: "_id countryId currencyCode rate",
    macroMetrics: "_id countryId economic population governance economicModel",
    federalBudget:
      "_id countryId currencyCode fiscalYear revenue spending debt treasuryBalance surplus gdp gdpSmoothed debtToGdpRatio creditRating taxRates taxBases economicFactors",
    bonds:
      "_id countryId corporationId issuerType defaulted matured faceValue couponRate maturityTurn totalIssued publicFloat marketPrice currencyCode",
    commodityPrices:
      "_id commodity turn basePrice globalPrice globalSupply globalDemand stateSupply demandTruncatedUnits latentShortageMultiple scarcityMult nationalPrices nationalSupply nationalDemand reachablePrices stateInputAvailability",
    economicVitalSigns: "_id turn goods trade production firms competition securities",
  };
  const entries = await Promise.all(
    Object.entries(fields).map(async ([collection, keys]) => {
      const projection = Object.fromEntries(keys.split(" ").map((key) => [key, 1]));
      const filter =
        collection === "corporationHistory" || collection === "economicVitalSigns" ? { turn } : {};
      return [
        collection,
        await db.collection(collection).find(filter, { projection }).toArray(),
      ] as const;
    })
  );
  const fetched = Object.fromEntries(entries);
  const collection = (name: string) => fetched[name] as Array<Record<string, unknown>>;
  const nppIds = new Set(
    collection("corporations")
      .filter(
        (corp) =>
          corp.ceoType === "npp" &&
          idString(corp.userId) === NPC_CORPORATION_USER_ID &&
          !Object.hasOwn(corp, "caretakerCeo") &&
          corp.suspended !== true
      )
      .map((corp) => idString(corp._id))
  );
  const nppSectorRows = collection("corporateSectors").filter(
    (sector) =>
      sector.sectorType === "extraction" &&
      nppIds.has(idString(sector.corporationId)) &&
      sector.transitionFromStrategyId == null
  );
  const nppStateIds = [...new Set(nppSectorRows.map((sector) => sector.stateId))];
  const [config, gameState] = await Promise.all([
    db.collection<GameConfig>("gameConfig").findOne(
      { _id: "default" },
      {
        projection: {
          marketSystemMode: 1,
          freightSettlementMode: 1,
          marketGovernorCap: 1,
        },
      }
    ),
    db.collection<GameState>("gameState").findOne(
      { _id: "current" },
      {
        projection: {
          currentTurn: 1,
          extractionAutoStrategyEnabled: 1,
          lastExtractionAutoStrategyTurn: 1,
          nppEntryViabilityMode: 1,
        },
      }
    ),
  ]);
  const marketMode = isMarketSystemMode(config?.marketSystemMode) ? config.marketSystemMode : "off";
  const shouldReadCapacities = nppSectorRows.length > 0;
  const shouldReadBooks = shouldReadCapacities && marketAtLeast(marketMode, "clearing");
  const [capacities, books] = await Promise.all([
    shouldReadCapacities
      ? db
          .collection("stateResourceCapacity")
          .find(
            { stateId: { $in: nppStateIds } },
            { projection: { stateId: 1, countryId: 1, resources: 1 } }
          )
          .toArray()
      : Promise.resolve([]),
    shouldReadBooks
      ? db
          .collection("tradeFlowSnapshots")
          .findOne(
            { books: { $exists: true }, turn: { $lte: turn } },
            { sort: { turn: -1 }, projection: { turn: 1, books: 1 } }
          )
      : Promise.resolve(null),
  ]);
  if (gameState?.currentTurn !== turn)
    throw new Error(`Snapshot turn ${turn} does not match game state`);
  const strategyObservation = buildExtractionStrategyObservation(
    turn,
    collection("corporateSectors"),
    collection("corporations"),
    collection("commodityPrices"),
    capacities,
    config ? { ...config } : null,
    gameState ? { ...gameState } : null,
    books && typeof books.turn === "number" ? { turn: books.turn, books: books.books } : null,
    observationClass
  );
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const filePath = join(directory, `${turn}.json`);
  await writeFile(
    filePath,
    JSON.stringify({
      turn,
      sourceMetadata: qualification.sourceMetadata,
      captureQualificationEligible: qualification.eligible,
      ...Object.fromEntries(entries),
      extractionStrategyObservation: strategyObservation,
    }),
    { mode: 0o600 }
  );
  await chmod(filePath, 0o600);
  return { strategyInputCount: strategyObservation.nppSectors.length };
}

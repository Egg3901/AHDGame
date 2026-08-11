/**
 * Command Economy v2 (P2) — assemble the per-country dashboard payload.
 *
 * One DB read path shared by the GET dashboard route (and re-usable by SSR).
 * Returns null when the country is not a flag-on planned economy, so callers
 * render nothing for market worlds. Pure shaping lives in
 * `@/lib/economy/commandEconomyDashboard`.
 */

import type { Db, ObjectId } from "mongodb";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getNationalBudgetId } from "@/lib/bonds/sovereign";
import { getCabinetMembersCollection } from "@/lib/db/collections/cabinetMembers";
import { commandEconomyOffices } from "@/lib/constants/commandEconomyOffices";
import {
  isPlannedEconomy,
  scheduledMarketizationLevel,
  NPP_DEFAULT_INTERNAL_REPRESSION,
} from "@/lib/constants/commandEconomy";
import type { FederalBudget } from "@/lib/db/types/budget";
import type { Corporation } from "@/lib/db/types/corporation";
import type { GameConfig, GameState } from "@/lib/db/types";
import type { GovernmentFormation } from "@/lib/db/types/governmentFormation";
import { resolveCommandEconomyRoles, canSetRepression } from "@/lib/economy/commandEconomyAuth";
import {
  computeMarketizationDrivers,
  gosbankCostLabel,
  repressionCostLabel,
  presentSoe,
  regimeFromLevel,
  regimeLabel,
  type CommandEconomyDashboard,
  type RawSoe,
} from "@/lib/economy/commandEconomyDashboard";

export async function loadCommandEconomyDashboard(
  db: Db,
  countryId: CountryId,
  viewerCharacterId: ObjectId | null
): Promise<CommandEconomyDashboard | null> {
  if (!commandEconomyOffices(countryId)) return null;

  const [gameConfig, gameState] = await Promise.all([
    db
      .collection<GameConfig>("gameConfig")
      .findOne({ _id: "default" }, { projection: { commandEconomyEnabled: 1 } }),
    db
      .collection<GameState>("gameState")
      .findOne({ _id: "current" }, { projection: { currentYear: 1, currentTurn: 1 } }),
  ]);
  const enabled = gameConfig?.commandEconomyEnabled === true;
  if (!enabled) return null;

  const currentYear = gameState?.currentYear ?? null;
  const currentTurn = gameState?.currentTurn ?? null;
  if (!isPlannedEconomy(countryId, currentYear, enabled)) return null;

  const offices = commandEconomyOffices(countryId)!;
  const cabinet = getCabinetMembersCollection(db);

  const [budget, corps, gov, plannerSeat, bankSeat, viewerRolesRaw] = await Promise.all([
    db
      .collection<FederalBudget>("federalBudget")
      .findOne({ _id: getNationalBudgetId(countryId) } as { _id: "federal" }),
    db
      .collection<Corporation>("corporations")
      .find({ countryId, soe: { $exists: true } }, { projection: { _id: 1, name: 1, soe: 1 } })
      .toArray(),
    db
      .collection<GovernmentFormation>("governmentFormations")
      .findOne({ _id: countryId } as { _id: string }, { projection: { commandStance: 1 } }),
    cabinet.findOne({ countryId, positionId: offices.plannerCabinetId }),
    cabinet.findOne({ countryId, positionId: offices.bankCabinetId }),
    viewerCharacterId
      ? resolveCommandEconomyRoles(db, countryId, viewerCharacterId)
      : Promise.resolve({ isHeadOfGovernment: false, isPlanner: false, isBankChair: false }),
  ]);

  const factors = budget?.economicFactors;
  const persistedLevel = factors?.marketizationLevel;
  const marketizationLevel =
    typeof persistedLevel === "number" && Number.isFinite(persistedLevel)
      ? persistedLevel
      : scheduledMarketizationLevel(countryId, currentYear);

  const directive = factors?.gosbankDirective;
  const directedCredit = factors?.directedCredit ?? null;

  // Resolve director display names for any SOE that lacks the denormalized name.
  const missingNameIds = corps.map((c) => c.soe?.directorId).filter((id): id is ObjectId => !!id);
  const nameById = new Map<string, string>();
  if (missingNameIds.length > 0) {
    const chars = await db
      .collection("characters")
      .find({ _id: { $in: missingNameIds } }, { projection: { name: 1 } })
      .toArray();
    for (const ch of chars)
      nameById.set(String(ch._id), (ch as { name?: string }).name ?? "Director");
  }

  const viewerCharIdStr = viewerCharacterId ? String(viewerCharacterId) : null;
  const rawSoes: RawSoe[] = corps
    .filter((c) => c.soe)
    .map((c) => {
      const soe = c.soe!;
      const directorId = soe.directorId ? String(soe.directorId) : null;
      const directorName =
        soe.directorName ?? (directorId ? (nameById.get(directorId) ?? null) : null);
      return {
        corpId: String(c._id),
        corpName: c.name,
        sector: soe.sector,
        output: soe.output,
        planTarget: soe.planTarget,
        capacity: soe.capacity,
        efficiency: soe.efficiency,
        cumulativeLosses: soe.cumulativeLosses,
        directorId,
        directorName,
        laborQuality: soe.directive?.laborQuality ?? null,
        investmentRequest: soe.directive?.investmentRequest ?? null,
        directedCreditLastTurn:
          directedCredit && typeof directedCredit[soe.sector] === "number"
            ? directedCredit[soe.sector]
            : null,
      };
    })
    .sort((a, b) => a.sector.localeCompare(b.sector));

  const soes = rawSoes.map((raw) => presentSoe(raw, viewerCharIdStr));
  const directedCorpIds = soes.filter((s) => s.viewerIsDirector).map((s) => s.corpId);

  const creditAggressiveness = num(
    directive?.creditAggressiveness,
    num(factors?.budgetSoftness, 0.55)
  );
  const budgetSoftness = num(directive?.budgetSoftness, num(factors?.budgetSoftness, 0.85));
  // P3: prefer the LIVE government reformism persisted by the turn phase (resolved
  // from the elected ruling party), falling back to the NPP-brain commandStance
  // estimate. Keeps the marketization-driver readout consistent with the drift.
  const reformism =
    typeof factors?.governmentReformism === "number"
      ? factors.governmentReformism
      : typeof gov?.commandStance?.reformism === "number"
        ? gov.commandStance.reformism
        : undefined;

  const drivers = computeMarketizationDrivers({
    shortageIndex: factors?.shortageIndex ?? null,
    blackMarketPremium: factors?.blackMarketPremium ?? null,
    secondEconomyShare: factors?.secondEconomyShare ?? null,
    soes,
    creditAggressiveness,
    budgetSoftness,
    reformism,
  });

  const regime = regimeFromLevel(marketizationLevel);

  // Internal repression: prefer a freshly-set player directive (may pre-date the
  // next turn writing the honored value), then the honored value the turn applied,
  // then the NPP-brain stance, then the default. Clamp to [0, 1].
  const repressionLevel = Math.max(
    0,
    Math.min(
      1,
      firstNum(
        factors?.repressionDirective?.level,
        factors?.internalRepression,
        gov?.commandStance?.internalRepression,
        NPP_DEFAULT_INTERNAL_REPRESSION
      )
    )
  );

  return {
    countryId,
    countryName: COUNTRY_CONFIGS[countryId]?.name ?? countryId,
    enabled,
    regime,
    regimeLabel: regimeLabel(regime),
    marketizationLevel,
    drivers,
    soes,
    aggregateFulfillment: drivers.soePerformance,
    gosbank: {
      creditAggressiveness,
      budgetSoftness,
      sectorCredit: directive?.sectorCredit ?? null,
      directedCreditLastTurn: directedCredit,
      issuanceLastTurn:
        typeof factors?.directedCreditIssuance === "number" ? factors.directedCreditIssuance : null,
      upkeepLastTurn:
        typeof factors?.directedCreditUpkeep === "number" ? factors.directedCreditUpkeep : null,
      monetaryOverhang: factors?.monetaryOverhang ?? null,
      shortageIndex: factors?.shortageIndex ?? null,
      blackMarketPremium: factors?.blackMarketPremium ?? null,
      costLabel: gosbankCostLabel(
        factors?.monetaryOverhang ?? null,
        factors?.shortageIndex ?? null,
        creditAggressiveness
      ),
    },
    repression: {
      level: repressionLevel,
      blackMarketPressureBase:
        typeof factors?.blackMarketPressureBase === "number"
          ? factors.blackMarketPressureBase
          : null,
      blackMarketPressureEffective:
        typeof factors?.blackMarketPressureEffective === "number"
          ? factors.blackMarketPressureEffective
          : null,
      legitimacyCostPerTurn:
        typeof factors?.repressionLegitimacyCost === "number"
          ? factors.repressionLegitimacyCost
          : null,
      costLabel: repressionCostLabel(
        repressionLevel,
        factors?.shortageIndex ?? null,
        factors?.repressionLegitimacyCost ?? null
      ),
    },
    plannerName: plannerSeat?.characterName ?? null,
    bankChairName: bankSeat?.characterName ?? null,
    viewerRoles: {
      ...viewerRolesRaw,
      canSetRepression: canSetRepression(viewerRolesRaw),
      directedCorpIds,
    },
    currentTurn,
  };
}

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/** First finite number among the args, else 0. */
function firstNum(...vals: Array<number | null | undefined>): number {
  for (const v of vals) {
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return 0;
}

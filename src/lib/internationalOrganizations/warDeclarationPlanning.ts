import type { Db } from "mongodb";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import type { ConflictDoc } from "@/lib/db/types/conflict";
import type { Bill } from "@/lib/db/types/legislation";
import { getAllCountryAccess, type CountryAccess } from "@/lib/countryAccess";
import { hasBillLifecycle } from "@/lib/legislature/hasBillLifecycle";
import { loadAllianceRoll, type AllianceRoll } from "@/lib/military/allianceBar";
import { sharesBloc } from "@/lib/military/bloc";
import { getConflictsCollection } from "@/lib/db/collections/conflicts";
import { opposedBelligerents } from "@/lib/military/occupation";
import { getTrucesCollection, trucePairId } from "@/lib/military/truce";
import { WAR_DECLARATION_COOLDOWN_TURNS } from "@/lib/military/warGoals";
import { planOrganizationWarDeclaration, type OrganizationWarPlan } from "./warDeclarationRules";

export interface OrganizationWarPlanningResult extends OrganizationWarPlan {
  conflictsEnabled: boolean;
  targetEnabled: boolean;
}

export interface OrganizationWarPlanningContext {
  conflictsEnabled: boolean;
  access: Record<CountryId, CountryAccess>;
  allianceRoll: AllianceRoll;
  activeTrucePairIds: ReadonlySet<string>;
  /** Mutable within one resolver pass so an earlier fanout gates later rows in the same turn. */
  latestDeclarationTurn: Map<CountryId, number>;
  liveConflicts: ReadonlyArray<Pick<ConflictDoc, "sideA" | "sideB">>;
}

/**
 * Load one projected world snapshot for every declaration closing in this phase.
 * The resolver shares it across rows so a large ballot batch cannot become an N+1.
 */
export async function loadOrganizationWarPlanningContext(
  db: Db,
  currentTurn: number
): Promise<OrganizationWarPlanningContext> {
  const countryIds = Object.keys(COUNTRY_CONFIGS) as CountryId[];
  const [access, allianceRoll, gameState, truces, declarationBills, conflicts] = await Promise.all([
    getAllCountryAccess(db),
    loadAllianceRoll(db),
    db
      .collection<{ _id: string; conflictsEnabled?: boolean }>("gameState")
      .findOne({ _id: "current" }, { projection: { conflictsEnabled: 1 } }),
    getTrucesCollection(db)
      .find({ expiresTurn: { $gt: currentTurn } }, { projection: { _id: 1 } })
      .toArray(),
    db
      .collection<Bill>("bills")
      .find(
        {
          countryId: { $in: countryIds },
          "provisions.type": "declare_war",
          proposedTurn: { $gt: currentTurn - WAR_DECLARATION_COOLDOWN_TURNS },
        },
        { projection: { countryId: 1, proposedTurn: 1 } }
      )
      .toArray(),
    getConflictsCollection(db)
      .find({ status: { $ne: "resolved" } }, { projection: { sideA: 1, sideB: 1 } })
      .toArray(),
  ]);

  const latestDeclarationTurn = new Map<CountryId, number>();
  for (const bill of declarationBills) {
    if (!bill.countryId || bill.proposedTurn == null) continue;
    latestDeclarationTurn.set(
      bill.countryId,
      Math.max(latestDeclarationTurn.get(bill.countryId) ?? -Infinity, bill.proposedTurn)
    );
  }

  return {
    conflictsEnabled: gameState?.conflictsEnabled === true,
    access,
    allianceRoll,
    activeTrucePairIds: new Set(truces.map((truce) => truce._id)),
    latestDeclarationTurn,
    liveConflicts: conflicts,
  };
}

/** Resolve eligibility from a shared snapshot, then delegate classification to the rules core. */
export async function planOrganizationWarDeclarationFromDb(params: {
  db: Db;
  memberIds: readonly string[];
  targetCountryId: CountryId;
  currentTurn: number;
  context?: OrganizationWarPlanningContext;
}): Promise<OrganizationWarPlanningResult> {
  const { db, targetCountryId, currentTurn } = params;
  const members = params.memberIds.filter(
    (member): member is CountryId => member in COUNTRY_CONFIGS
  );
  const context = params.context ?? (await loadOrganizationWarPlanningContext(db, currentTurn));
  const { access, allianceRoll, activeTrucePairIds, latestDeclarationTurn, liveConflicts } =
    context;

  const targetEnabled = access[targetCountryId]?.enabledForPlayers === true;
  const alreadyAtWar = new Set<CountryId>();
  for (const conflict of liveConflicts) {
    for (const member of members) {
      if (opposedBelligerents(conflict, member, targetCountryId)) alreadyAtWar.add(member);
    }
  }

  const plan = planOrganizationWarDeclaration({
    targetCountryId,
    members: members.map((countryId) => {
      const lastTurn = latestDeclarationTurn.get(countryId);
      const playerEnabled = access[countryId]?.enabledForPlayers === true;
      // The cooldown represents the political capital spent filing a national
      // declaration. Automatic NPP coalition entry files no national bill.
      const offCooldown =
        !playerEnabled ||
        lastTurn == null ||
        currentTurn - lastTurn >= WAR_DECLARATION_COOLDOWN_TURNS;
      return {
        countryId,
        playerEnabled,
        nppGoverned: access[countryId]?.nppGoverned === true,
        hasLegislature: hasBillLifecycle(countryId),
        legallyEligible:
          targetEnabled &&
          !sharesBloc(allianceRoll.blocs, countryId, targetCountryId) &&
          !activeTrucePairIds.has(trucePairId(countryId, targetCountryId)) &&
          !alreadyAtWar.has(countryId) &&
          offCooldown,
      };
    }),
  });
  return { ...plan, conflictsEnabled: context.conflictsEnabled, targetEnabled };
}

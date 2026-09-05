/**
 * Autonomous union and employer bargaining for NPP-run worlds.
 *
 * Leadership election remains NPP-specific. Every industrial-relations
 * decision after that uses the same campaign, offer, escalation, mediation,
 * settlement, and agreement services as player actions. Union dues v1
 * retired the recruitment drive this file used to run for NPP leaders, see
 * the comment above the leadership loop below.
 */
import type { Db, ObjectId } from "mongodb";
import type {
  BargainingCampaign,
  CollectiveAgreement,
  Corporation,
  CorporateSector,
  Union,
} from "@/lib/db/types";
import type { NPP } from "@/lib/db/types/npp";
import { getLabourSystemMode, labourAtLeast } from "@/lib/labour/featureFlag";
import { getNppAutonomyLevel, nppAutonomyLevelAtLeast } from "@/lib/nppAutonomy/featureFlag";
import {
  activeCollectiveAgreementFilter,
  getBargainingMediationAvailability,
} from "@/lib/unions/bargaining";
import {
  openBargainingCampaignFromLiveConditions,
  persistBargainingCounter,
  persistBargainingMediationAction,
  persistBargainingSettlement,
  persistUnionBargainingEscalation,
} from "@/lib/unions/commands/bargaining";
import { STRIKE_CALL_MIN_UNIONIZATION } from "@/lib/unions/unionEconomy";
import {
  calculateNppSettlementWage,
  decideNppBargainingAction,
  industrialActionPressure,
} from "./nppBargainingPolicy";

/**
 * Minimum worker-weighted `unionization` (0-100) across an NPP union's scope
 * before its leader bothers opening a wage claim. Union dues v1 renamed this
 * from a `membershipPressure` proxy to the real coverage stat it always meant
 * to gate on.
 */
export const NPP_DEMAND_MIN_UNIONIZATION = 15;
export const NPP_DEMAND_PREMIUM = 0.12;
export const NPP_DEMAND_CEILING = 1.5;
export const NPP_CAMPAIGN_OPEN_LIMIT_PER_TURN = 24;
export interface NppUnionBehaviorResult {
  leadersElected: number;
  campaignsOpened: number;
  counteroffersMade: number;
  agreementsSettled: number;
  disputesEscalated: number;
  mediationsRequested: number;
  mediationResponses: number;
}

const EMPTY: NppUnionBehaviorResult = {
  leadersElected: 0,
  campaignsOpened: 0,
  counteroffersMade: 0,
  agreementsSettled: 0,
  disputesEscalated: 0,
  mediationsRequested: 0,
  mediationResponses: 0,
};

function pickDeterministic<T>(candidates: T[], seed: ObjectId): T {
  const hex = seed.toHexString();
  let accumulator = 0;
  for (let index = hex.length - 8; index < hex.length; index++) {
    accumulator = (accumulator * 31 + hex.charCodeAt(index)) >>> 0;
  }
  return candidates[accumulator % candidates.length];
}

function militancy(npp: Pick<NPP, "personality">): number {
  const ambition = npp.personality?.ambition ?? 50;
  const stubbornness = npp.personality?.stubbornness ?? 50;
  return Math.max(0, Math.min(1, (ambition * 0.6 + stubbornness * 0.4) / 100));
}

function weightedAverage(
  sectors: readonly CorporateSector[],
  read: (sector: CorporateSector) => number
): number {
  let weighted = 0;
  let totalWeight = 0;
  for (const sector of sectors) {
    const weight = Math.max(1, sector.workers ?? 0);
    weighted += read(sector) * weight;
    totalWeight += weight;
  }
  return totalWeight > 0 ? weighted / totalWeight : 0;
}

function campaignKey(unionId: ObjectId, employerId: ObjectId): string {
  return `${unionId.toHexString()}::${employerId.toHexString()}`;
}

function groupSectorsByScopeAndEmployer(sectors: readonly CorporateSector[]) {
  const groups = new Map<string, CorporateSector[]>();
  for (const sector of sectors) {
    const key = `${sector.countryId}::${sector.sectorType}::${sector.corporationId.toHexString()}`;
    const group = groups.get(key) ?? [];
    group.push(sector);
    groups.set(key, group);
  }
  return groups;
}

function campaignSectors(
  campaign: BargainingCampaign,
  sectorById: ReadonlyMap<string, CorporateSector>
): CorporateSector[] {
  return campaign.sectorIds
    .map((sectorId) => sectorById.get(sectorId.toHexString()))
    .filter((sector): sector is CorporateSector => sector != null);
}

export async function processNppUnionBehavior(
  db: Db,
  currentTurn: number
): Promise<NppUnionBehaviorResult> {
  const autonomy = await getNppAutonomyLevel(db);
  if (!nppAutonomyLevelAtLeast(autonomy, "v3")) return { ...EMPTY };
  if (!labourAtLeast(await getLabourSystemMode(), "full")) return { ...EMPTY };

  const unions = await db
    .collection<Union>("unions")
    .find({ suspended: { $ne: true } })
    .toArray();
  if (unions.length === 0) return { ...EMPTY };

  const result: NppUnionBehaviorResult = { ...EMPTY };
  const now = new Date();

  const vacant = unions.filter((union) => union.ownerId == null);
  if (vacant.length > 0) {
    const countries = [...new Set(vacant.map((union) => union.countryId))];
    const candidates = await db
      .collection<NPP>("npps")
      .find(
        { countryId: { $in: countries }, retiredAt: null },
        { projection: { _id: 1, countryId: 1, personality: 1 } }
      )
      .toArray();
    const taken = new Set(
      unions
        .filter((union) => union.ownerType === "npp" && union.ownerId)
        .map((union) => union.ownerId!.toHexString())
    );
    const byCountry = new Map<string, NPP[]>();
    for (const candidate of candidates) {
      if (!candidate.countryId || taken.has(candidate._id.toHexString())) continue;
      const pool = byCountry.get(candidate.countryId) ?? [];
      pool.push(candidate);
      byCountry.set(candidate.countryId, pool);
    }
    for (const pool of byCountry.values()) {
      pool.sort(
        (left, right) =>
          militancy(right) - militancy(left) ||
          left._id.toHexString().localeCompare(right._id.toHexString())
      );
    }

    const electionOps = [];
    for (const union of [...vacant].sort((a, b) =>
      a._id.toHexString().localeCompare(b._id.toHexString())
    )) {
      const pool = byCountry.get(union.countryId);
      if (!pool?.length) continue;
      const shortlist = pool.slice(0, Math.max(1, Math.ceil(pool.length / 2)));
      const chosen = pickDeterministic(shortlist, union._id);
      pool.splice(
        pool.findIndex((candidate) => candidate._id.equals(chosen._id)),
        1
      );
      electionOps.push({
        updateOne: {
          filter: { _id: union._id, ownerId: null },
          update: {
            $set: { ownerId: chosen._id, ownerType: "npp" as const, updatedAt: now },
            $unset: { pendingLeaderCharacterId: "" as const },
          },
        },
      });
      union.ownerId = chosen._id;
      union.ownerType = "npp";
    }
    if (electionOps.length > 0) {
      await db.collection<Union>("unions").bulkWrite(electionOps);
      result.leadersElected = electionOps.length;
    }
  }

  const led = unions.filter(
    (union): union is Union & { ownerId: ObjectId } =>
      union.ownerType === "npp" && union.ownerId != null
  );

  const leaders = await db
    .collection<NPP>("npps")
    .find(
      { _id: { $in: led.map((union) => union.ownerId) }, retiredAt: null },
      { projection: { _id: 1, personality: 1 } }
    )
    .toArray();
  const leaderById = new Map(leaders.map((leader) => [leader._id.toHexString(), leader]));
  const orphaned: ObjectId[] = [];
  // Union dues v1 retired the recruitment drive (spend treasury to raise
  // membershipPressure): a union's members are now a real headcount derived
  // straight from represented-sector workers x unionization every turn
  // (`processUnionsTurn`), so there is nothing left for an NPP leader to
  // "recruit" into. This loop now only clears `demandedWageLevel` and detects
  // orphaned leadership, see NEEDS OTHER AGENTS in this branch's report for
  // the open question of whether NPP leaders should get a dues/services policy
  // lever to replace what recruiting used to be.
  const clearOps = [];
  for (const union of led) {
    const leader = leaderById.get(union.ownerId.toHexString());
    if (!leader) {
      orphaned.push(union._id);
      continue;
    }
    if (union.demandedWageLevel != null) {
      union.demandedWageLevel = null;
      clearOps.push({
        updateOne: {
          filter: { _id: union._id },
          update: { $set: { demandedWageLevel: null, updatedAt: now } },
        },
      });
    }
  }
  if (orphaned.length > 0) {
    await db
      .collection<Union>("unions")
      .updateMany(
        { _id: { $in: orphaned } },
        { $set: { ownerId: null, updatedAt: now }, $unset: { ownerType: "" } }
      );
  }
  if (clearOps.length > 0) await db.collection<Union>("unions").bulkWrite(clearOps);

  const activeLed = led.filter((union) => !orphaned.some((id) => id.equals(union._id)));
  const [sectors, corporations, campaignSnapshot, activeAgreements] = await Promise.all([
    // `plantsPnl` is ~48% of the document and union behaviour never reads it.
    db
      .collection<CorporateSector>("corporateSectors")
      .find({}, { projection: { plantsPnl: 0 } })
      .toArray(),
    db
      .collection<Corporation>("corporations")
      .find(
        { isDefunct: { $ne: true } },
        { projection: { _id: 1, ceoId: 1, ceoType: 1, caretakerCeo: 1 } }
      )
      .toArray(),
    db
      .collection<BargainingCampaign>("bargainingCampaigns")
      .find({ status: { $in: ["negotiating", "dispute"] } })
      .toArray(),
    db
      .collection<CollectiveAgreement>("collectiveAgreements")
      .find({
        ...activeCollectiveAgreementFilter(currentTurn),
      })
      .toArray(),
  ]);
  const corporationById = new Map(
    corporations.map((corporation) => [corporation._id.toHexString(), corporation])
  );
  const sectorById = new Map(sectors.map((sector) => [sector._id.toHexString(), sector]));
  const sectorGroups = groupSectorsByScopeAndEmployer(sectors);
  const unavailable = new Set([
    ...campaignSnapshot.map((campaign) =>
      campaignKey(campaign.unionId, campaign.employerCorporationId)
    ),
    ...activeAgreements.map((agreement) =>
      campaignKey(agreement.unionId, agreement.employerCorporationId)
    ),
  ]);

  for (const union of [...activeLed].sort((a, b) =>
    a._id.toHexString().localeCompare(b._id.toHexString())
  )) {
    if (result.campaignsOpened >= NPP_CAMPAIGN_OPEN_LIMIT_PER_TURN) break;
    const leader = leaderById.get(union.ownerId.toHexString());
    if (!leader) continue;
    const scopeLocals = sectors.filter(
      (sector) => sector.countryId === union.countryId && sector.sectorType === union.sectorType
    );
    if (scopeLocals.length === 0) continue;
    // Union dues v1: membershipPressure retired, coverage within scope, read
    // directly off the same sectors' own `unionization`, is what "is this
    // industry organized enough to bother demanding" now means.
    const scopeAverageUnionization = weightedAverage(
      scopeLocals,
      (local) => local.unionization ?? 0
    );
    if (scopeAverageUnionization < NPP_DEMAND_MIN_UNIONIZATION) continue;
    const scopeAverageWage = weightedAverage(scopeLocals, (local) => local.wageLevel ?? 1);
    const claim = Math.min(
      NPP_DEMAND_CEILING,
      scopeAverageWage * (1 + NPP_DEMAND_PREMIUM * (0.5 + militancy(leader)))
    );
    const candidates = [...sectorGroups.entries()]
      .filter(([key, locals]) => {
        const [countryId, sectorType, employerId] = key.split("::");
        return (
          countryId === union.countryId &&
          sectorType === union.sectorType &&
          corporationById.has(employerId) &&
          !unavailable.has(campaignKey(union._id, locals[0].corporationId)) &&
          locals.some((local) => (local.unionization ?? 0) >= STRIKE_CALL_MIN_UNIONIZATION)
        );
      })
      .map(([, locals]) => {
        const grievance = weightedAverage(locals, (local) =>
          Math.max(0, claim - (local.wageLevel ?? 1))
        );
        const workers = locals.reduce((sum, local) => sum + Math.max(0, local.workers ?? 0), 0);
        return { employerId: locals[0].corporationId, claim, grievance, workers };
      })
      .sort(
        (left, right) =>
          right.grievance - left.grievance ||
          right.workers - left.workers ||
          left.employerId.toHexString().localeCompare(right.employerId.toHexString())
      );
    const candidate = candidates[0];
    if (!candidate) continue;
    const opened = await openBargainingCampaignFromLiveConditions(
      db,
      union,
      candidate.employerId.toHexString(),
      {
        wageLevel: Math.round(candidate.claim * 100) / 100,
        agreementDurationTurns: 48,
        noStrikeTurns: 24,
      },
      currentTurn
    );
    if (opened.ok) {
      result.campaignsOpened++;
      unavailable.add(campaignKey(union._id, candidate.employerId));
    }
  }

  const unionById = new Map(unions.map((union) => [union._id.toHexString(), union]));
  for (const campaign of campaignSnapshot) {
    if (campaign.lastActionTurn >= currentTurn) continue;
    const union = unionById.get(campaign.unionId.toHexString());
    const employer = corporationById.get(campaign.employerCorporationId.toHexString());
    const locals = campaignSectors(campaign, sectorById);
    if (!union || !employer || locals.length === 0) continue;
    const employerWageLevel = weightedAverage(locals, (local) => local.wageLevel ?? 1);
    const employerProfitMargin = weightedAverage(locals, (local) => local.profitMargin ?? 0);
    const unionIsNpp = union.ownerType === "npp" && union.ownerId != null;
    const employerIsNpp = employer.ceoType === "npp" && employer.ceoId != null;

    if (campaign.mediation?.status === "pending") {
      const party =
        !campaign.mediation.unionAccepted && unionIsNpp
          ? "union"
          : !campaign.mediation.employerAccepted && employerIsNpp
            ? "employer"
            : null;
      if (!party) continue;
      const opening = campaign.offers.find((offer) => offer.proposedBy === "union");
      if (!opening) continue;
      const settlementWage = calculateNppSettlementWage({
        openingUnionWage: opening.wageLevel,
        employerWageLevel,
        unionLeverage: campaign.mandate.leverage,
        employerProfitMargin,
        actionPressure: industrialActionPressure({
          escalationLevel: campaign.escalationLevel,
          ...(campaign.escalationStartedAtTurn != null && {
            escalationStartedAtTurn: campaign.escalationStartedAtTurn,
          }),
          currentTurn,
        }),
      });
      const accepts =
        party === "union"
          ? campaign.mediation.wageLevel >= settlementWage
          : campaign.mediation.wageLevel <= settlementWage;
      const response = await persistBargainingMediationAction(
        db,
        campaign,
        party,
        accepts ? "accept_mediation" : "reject_mediation",
        currentTurn
      );
      if (response.ok) {
        result.mediationResponses++;
        if (response.campaignStatus === "settled") result.agreementsSettled++;
      }
      continue;
    }

    const responseParty =
      campaign.currentOffer.proposedBy === "union" && employerIsNpp
        ? "employer"
        : campaign.currentOffer.proposedBy === "employer" && unionIsNpp
          ? "union"
          : null;
    if (responseParty) {
      const decision = decideNppBargainingAction({
        campaign,
        party: responseParty,
        currentTurn,
        employerWageLevel,
        employerProfitMargin,
      });
      if (decision.action === "accept") {
        const accepted = await persistBargainingSettlement(
          db,
          campaign,
          responseParty,
          currentTurn
        );
        if (accepted.ok) result.agreementsSettled++;
        continue;
      }
      if (decision.action === "counter") {
        const countered = await persistBargainingCounter(
          db,
          campaign,
          responseParty,
          decision.terms,
          currentTurn
        );
        if (countered.ok) result.counteroffersMade++;
        continue;
      }
    }
    if (campaign.status !== "dispute") continue;

    // Industrial action belongs to the union, not to whichever side authored
    // the current offer. This keeps an NPP union active after a player CEO makes
    // a direct hardline rejection with no employer counteroffer.
    const disputeParty = unionIsNpp ? "union" : employerIsNpp ? "employer" : null;
    if (!disputeParty) continue;

    const mediationAvailability = getBargainingMediationAvailability(campaign, currentTurn);
    if (mediationAvailability.available) {
      const requested = await persistBargainingMediationAction(
        db,
        campaign,
        disputeParty,
        "request_mediation",
        currentTurn
      );
      if (requested.ok) result.mediationsRequested++;
    } else if (disputeParty === "union") {
      const escalated = await persistUnionBargainingEscalation(db, union, campaign, currentTurn);
      if (escalated.ok) result.disputesEscalated++;
    }
  }

  return result;
}

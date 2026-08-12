import type { AnyBulkWriteOperation, Db, ObjectId } from "mongodb";
import type {
  Character,
  BargainingCampaign,
  CollectiveAgreement,
  Corporation,
  CorporateSector,
  StateMetrics,
  Union,
} from "@/lib/db/types";
import { createNotifications, type NotificationInput } from "@/lib/notifications";
import { disputeLapseTurn, escalationUpkeepPerTurn } from "@/lib/unions/bargaining";
import {
  MANDATE_LOCAL_PROJECTION,
  bargainingMacroInputs,
  mandateFromLocals,
  restoreEscalationExpectations,
  type MandateLocal,
} from "@/lib/unions/commands/bargaining";
import { closeDueRatificationVotes } from "@/lib/unions/commands/ratifySettlement";

export interface LabourRelationsTurnResult {
  campaignsMovedToDispute: number;
  agreementsExpired: number;
  mediationsExpired: number;
  mandatesRefreshed: number;
  overtimeBansFunded: number;
  overtimeBansEnded: number;
  disputesLapsed: number;
  settlementsRatified: number;
  settlementsRejected: number;
  ratificationsVoided: number;
}

/**
 * Advance deadline and expiry state, keep every open campaign's mandate in
 * step with live conditions, charge held industrial action, and close out
 * disputes that have run their course. Economic enforcement reads turn bounds
 * directly.
 */
export async function processLabourRelationsTurn(
  db: Db,
  currentTurn: number
): Promise<LabourRelationsTurnResult> {
  const now = new Date();
  const [campaigns, agreements, mediations] = await Promise.all([
    db.collection<BargainingCampaign>("bargainingCampaigns").updateMany(
      { status: "negotiating", deadlineTurn: { $lte: currentTurn } },
      {
        $set: {
          status: "dispute",
          disputeStartedAtTurn: currentTurn,
          updatedAt: now,
        },
      }
    ),
    db
      .collection<CollectiveAgreement>("collectiveAgreements")
      .updateMany(
        { status: "active", expiresAtTurn: { $lte: currentTurn } },
        { $set: { status: "expired", updatedAt: now } }
      ),
    db.collection<BargainingCampaign>("bargainingCampaigns").updateMany(
      {
        status: "dispute",
        "mediation.status": "pending",
        "mediation.expiresAtTurn": { $lte: currentTurn },
      },
      { $set: { "mediation.status": "expired", "mediation.updatedAt": now, updatedAt: now } }
    ),
  ]);

  // Close member ballots before lapsing: a settlement the members ratified on
  // the same turn a dispute runs out of road is a settlement, not a lapse.
  const ratifications = await closeDueRatificationVotes(db, currentTurn);

  // Lapse first so a dying dispute is not charged upkeep on its final turn.
  const lapsed = await lapseStaleDisputes(db, currentTurn, now);
  const { mandatesRefreshed, overtimeBansFunded, overtimeBansEnded, endedBans } =
    await refreshOpenCampaigns(db, currentTurn, now);

  // Both of these end industrial action the leader called and paid for, out of
  // turn processing, with no action of theirs behind it. Silent is unreadable.
  await notifyLabourRelationsEvents(db, currentTurn, [
    ...lapsed.campaigns.map((campaign) => ({ ...campaign, kind: "lapsed" as const })),
    ...endedBans.map((ban) => ({ ...ban, kind: "ban_defunded" as const })),
  ]);

  return {
    campaignsMovedToDispute: campaigns.modifiedCount,
    agreementsExpired: agreements.modifiedCount,
    mediationsExpired: mediations.modifiedCount,
    mandatesRefreshed,
    overtimeBansFunded,
    overtimeBansEnded,
    disputesLapsed: lapsed.count,
    settlementsRatified: ratifications.ratified,
    settlementsRejected: ratifications.rejected,
    ratificationsVoided: ratifications.voided,
  };
}

/** One campaign-level consequence a union leader has to be told about. */
interface LabourRelationsEvent {
  kind: "lapsed" | "ban_defunded";
  campaignId: ObjectId;
  unionId: ObjectId;
  employerCorporationId: ObjectId;
  /** Upkeep the treasury could not cover, on a defunded ban only. */
  upkeep?: number;
}

/**
 * Tell the union leader that the turn pass ended something they were running.
 * A lapsed dispute and a ban that outran the treasury both look identical to a
 * leader who only sees the result: the campaign simply stopped. Follows the
 * same batched `createNotifications` pattern as every other turn-phase
 * consequence, and swallows nothing of its own: notification failure is
 * already non-fatal inside that helper.
 */
async function notifyLabourRelationsEvents(
  db: Db,
  currentTurn: number,
  events: LabourRelationsEvent[]
): Promise<void> {
  if (events.length === 0) return;

  const [unions, corporations] = await Promise.all([
    db
      .collection<Union>("unions")
      .find(
        { _id: { $in: events.map((event) => event.unionId) } },
        { projection: { name: 1, ownerId: 1, ownerType: 1 } }
      )
      .toArray(),
    db
      .collection<Corporation>("corporations")
      .find(
        { _id: { $in: events.map((event) => event.employerCorporationId) } },
        { projection: { name: 1 } }
      )
      .toArray(),
  ]);
  // NPP-led unions have no User behind the leader, same exclusion the
  // inactivity sweep makes.
  const unionById = new Map(
    unions
      .filter((union) => union.ownerType !== "npp")
      .map((union) => [union._id.toString(), union])
  );
  const corpNameById = new Map(corporations.map((corp) => [corp._id.toString(), corp.name]));

  const ownerIds = [...unionById.values()]
    .map((union) => union.ownerId)
    .filter((id): id is ObjectId => id != null);
  if (ownerIds.length === 0) return;
  const characters = await db
    .collection<Character>("characters")
    .find({ _id: { $in: ownerIds } }, { projection: { userId: 1 } })
    .toArray();
  const userIdByCharacterId = new Map(
    characters.map((character) => [character._id.toString(), character.userId])
  );

  const notifications: NotificationInput[] = [];
  for (const event of events) {
    const union = unionById.get(event.unionId.toString());
    const userId = union?.ownerId ? userIdByCharacterId.get(union.ownerId.toString()) : undefined;
    if (!userId) continue;
    const employer = corpNameById.get(event.employerCorporationId.toString()) ?? "the employer";
    notifications.push({
      userId,
      type: event.kind === "lapsed" ? "bargaining_dispute_lapsed" : "overtime_ban_defunded",
      title:
        event.kind === "lapsed"
          ? "Bargaining dispute lapsed"
          : "Overtime ban ended: treasury short",
      message:
        event.kind === "lapsed"
          ? `The dispute with ${employer} ran its full course without a settlement and has lapsed on turn ${currentTurn}. Industrial action has stopped and the pair can bargain again after the cooling-off period.`
          : `${union?.name ?? "The union"} could not cover the ${event.upkeep?.toLocaleString("en-US") ?? ""} per turn upkeep on the overtime ban at ${employer}, so the ban ended on turn ${currentTurn}. Rebuild the treasury before escalating again.`,
      metadata: {
        campaignId: event.campaignId,
        unionId: event.unionId,
        employerCorporationId: event.employerCorporationId,
        turn: currentTurn,
        ...(event.upkeep != null ? { upkeep: event.upkeep } : {}),
      },
    });
  }
  await createNotifications(notifications);
}

/**
 * A dispute is the one campaign state with no exit: the employer can only
 * accept, counter, or reject into dispute, and rejecting again changes
 * nothing. Left open, a deadlocked campaign holds industrial action on the
 * employer forever and permanently blocks the pair from bargaining again.
 * After BARGAINING_DISPUTE_MAX_TURNS the dispute lapses unresolved, industrial
 * action stops, and the shop floor goes back to where it was.
 */
async function lapseStaleDisputes(
  db: Db,
  currentTurn: number,
  now: Date
): Promise<{ count: number; campaigns: LapsedCampaign[] }> {
  const collection = db.collection<BargainingCampaign>("bargainingCampaigns");
  const stale = await collection
    .find(
      { status: "dispute" },
      {
        projection: {
          disputeStartedAtTurn: 1,
          deadlineTurn: 1,
          escalationExpectations: 1,
          unionId: 1,
          employerCorporationId: 1,
        },
      }
    )
    .toArray();
  const expired = stale.filter((campaign) => currentTurn >= disputeLapseTurn(campaign));
  if (expired.length === 0) return { count: 0, campaigns: [] };

  // Any member ballot still open on a lapsing campaign is void: there is
  // nothing left to ratify. Closing them first keeps a vote from being decided
  // against a campaign that has already ended.
  await collection.updateMany(
    {
      _id: { $in: expired.map((campaign) => campaign._id) },
      status: "dispute",
      "ratification.status": "open",
    },
    {
      $set: {
        "ratification.status": "void",
        "ratification.closedAtTurn": currentTurn,
        "ratification.updatedAt": now,
      },
    }
  );
  const result = await collection.updateMany(
    { _id: { $in: expired.map((campaign) => campaign._id) }, status: "dispute" },
    {
      $set: {
        status: "lapsed",
        escalationLevel: "none",
        endedAtTurn: currentTurn,
        lastActionTurn: currentTurn,
        updatedAt: now,
      },
    }
  );
  for (const campaign of expired) await restoreEscalationExpectations(db, campaign);
  return {
    count: result.modifiedCount,
    campaigns: expired.map((campaign) => ({
      campaignId: campaign._id,
      unionId: campaign.unionId,
      employerCorporationId: campaign.employerCorporationId,
    })),
  };
}

interface LapsedCampaign {
  campaignId: ObjectId;
  unionId: ObjectId;
  employerCorporationId: ObjectId;
}

interface RefreshCounters {
  mandatesRefreshed: number;
  overtimeBansFunded: number;
  overtimeBansEnded: number;
  /** Bans cancelled this turn because the treasury could not pay the upkeep. */
  endedBans: (LapsedCampaign & { upkeep: number })[];
}

/**
 * Recompute every open campaign's mandate from live conditions and charge the
 * upkeep on any overtime ban being held. A mandate frozen at opening means
 * organizing during a dispute earns nothing and a collapsed union keeps the
 * authority to call strikes; free industrial action means holding a ban
 * forever always beats settling.
 */
async function refreshOpenCampaigns(
  db: Db,
  currentTurn: number,
  now: Date
): Promise<RefreshCounters> {
  const counters: RefreshCounters = {
    mandatesRefreshed: 0,
    overtimeBansFunded: 0,
    overtimeBansEnded: 0,
    endedBans: [],
  };
  const campaigns = await db
    .collection<BargainingCampaign>("bargainingCampaigns")
    .find({ status: { $in: ["negotiating", "dispute"] } })
    .toArray();
  if (campaigns.length === 0) return counters;

  const [locals, unions] = await Promise.all([
    db
      .collection<CorporateSector>("corporateSectors")
      .find(
        { _id: { $in: campaigns.flatMap((c) => c.sectorIds) } },
        { projection: MANDATE_LOCAL_PROJECTION }
      )
      .toArray(),
    db
      .collection<Union>("unions")
      .find(
        { _id: { $in: campaigns.map((c) => c.unionId) } },
        { projection: { treasury: 1, countryId: 1 } }
      )
      .toArray(),
  ]);
  const localById = new Map<string, MandateLocal>(locals.map((l) => [l._id.toString(), l]));
  const unionById = new Map(unions.map((union) => [union._id.toString(), union]));

  const stateIds = [...new Set(locals.map((local) => local.stateId).filter(Boolean))];
  const metrics =
    stateIds.length > 0
      ? await db
          .collection<StateMetrics>("macroMetrics")
          .find({ _id: { $in: stateIds } }, { projection: { "economic.costOfLiving": 1 } })
          .toArray()
      : [];
  const colByState = new Map<string, number>();
  for (const doc of metrics) {
    const value = doc.economic?.costOfLiving?.value;
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      colByState.set(doc._id.toString(), value);
    }
  }

  const macroByCountry = new Map<string, Awaited<ReturnType<typeof bargainingMacroInputs>>>();
  const campaignOps: AnyBulkWriteOperation<BargainingCampaign>[] = [];
  const treasuryByUnion = new Map<string, number>();

  for (const campaign of campaigns) {
    const union = unionById.get(campaign.unionId.toString());
    if (!union) continue;
    const scoped = campaign.sectorIds
      .map((id) => localById.get(id.toString()))
      .filter((local): local is MandateLocal => local != null);
    if (scoped.length === 0) continue;

    let macro = macroByCountry.get(campaign.countryId);
    if (!macro) {
      macro = await bargainingMacroInputs(db, campaign.countryId);
      macroByCountry.set(campaign.countryId, macro);
    }

    const treasury = treasuryByUnion.get(union._id.toString()) ?? union.treasury;
    // An overtime ban is organized withdrawal of labour that the union has to
    // keep paying for. When the fund runs dry the action ends, which is the
    // negative feedback the ladder needs to be a real decision.
    let escalationLevel = campaign.escalationLevel;
    let remainingTreasury = treasury;
    if (campaign.status === "dispute" && campaign.escalationLevel === "overtime_ban") {
      const upkeep = escalationUpkeepPerTurn("overtime_ban", scoped.length);
      if (remainingTreasury >= upkeep) {
        remainingTreasury -= upkeep;
        counters.overtimeBansFunded++;
      } else {
        escalationLevel = "none";
        counters.overtimeBansEnded++;
        counters.endedBans.push({
          campaignId: campaign._id,
          unionId: campaign.unionId,
          employerCorporationId: campaign.employerCorporationId,
          upkeep,
        });
      }
    }
    treasuryByUnion.set(union._id.toString(), remainingTreasury);

    const mandate = mandateFromLocals({
      locals: scoped,
      treasury: remainingTreasury,
      laborTightness: macro.laborTightness,
      lawSupport: macro.lawSupport,
      costOfLivingByState: colByState,
    });
    campaignOps.push({
      updateOne: {
        filter: { _id: campaign._id, status: campaign.status },
        update: {
          $set: {
            mandate,
            mandateUpdatedAtTurn: currentTurn,
            escalationLevel,
            updatedAt: now,
          },
        },
      },
    });
  }

  if (campaignOps.length > 0) {
    const result = await db
      .collection<BargainingCampaign>("bargainingCampaigns")
      .bulkWrite(campaignOps);
    counters.mandatesRefreshed = result.modifiedCount;
  }

  const treasuryOps: AnyBulkWriteOperation<Union>[] = [];
  for (const [unionId, treasury] of treasuryByUnion) {
    const union = unionById.get(unionId);
    if (!union || union.treasury === treasury) continue;
    treasuryOps.push({
      updateOne: {
        filter: { _id: union._id },
        update: { $set: { treasury: Math.max(0, treasury), updatedAt: now } },
      },
    });
  }
  if (treasuryOps.length > 0) await db.collection<Union>("unions").bulkWrite(treasuryOps);

  return counters;
}

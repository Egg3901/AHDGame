import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { stateBillProvisionSchema } from "@/lib/api/schemas/congress";
import type { GovernorQueuedBill, NPP, ElectedOfficial, StateBill } from "@/lib/db/types";
import { getSubNationalLegislatureKey } from "@/lib/constants/countries";
import { STATE_TERMINAL_STATUSES } from "@/lib/congress/billProposalLimits";
import { cancelQueue } from "@/lib/governorOffice/legislation/cancelQueue";
import { canManageOffice } from "@/lib/governorOffice/access";

const VOTING_DURATION_HOURS = 24;

/**
 * Turn phase: fire every pending GovernorQueuedBill whose
 * queuedAtTurn < currentTurn. Each entry either becomes a real StateBill
 * (with sponsorNppId set + proposedByGovernor metadata) or is auto-cancelled
 * with refund if the target NPP / governor became ineligible.
 *
 * Must run BEFORE processStateBillVoting so the new bill is visible for
 * voting on its first turn.
 */
export async function processGovernorLegislationQueue(
  db: Db,
  currentTurn: number
): Promise<{ fired: number; cancelled: number }> {
  const pending = await db
    .collection<GovernorQueuedBill>("governorLegislationQueue")
    .find({ status: "pending", queuedAtTurn: { $lt: currentTurn } })
    .toArray();
  let fired = 0;
  let cancelled = 0;
  const now = new Date();

  for (const q of pending) {
    if (!q._id) continue;

    // 1. Queuer still authorized to manage this office? The human holder
    //    qualifies; for an NPP-held office an authorized party officer (state
    //    Chair/Vice, or national Chair/Vice when the state party has neither)
    //    qualifies too — the same delegation that allowed queuing the bill.
    //    (A by-characterId holder lookup would always fail for NPP-held offices,
    //    whose seat has no character, so officer-queued bills must use this.)
    const stillAuthorized = await canManageOffice(
      db,
      q.countryId,
      q.stateId,
      q.governorCharacterId
    );
    if (!stillAuthorized) {
      await cancelQueue(db, q._id, "governor_left_office");
      cancelled++;
      continue;
    }

    // 2. NPP still eligible?
    const npp = await db.collection<NPP>("npps").findOne({ _id: q.targetNppId });
    if (!npp || npp.retiredAt != null) {
      await cancelQueue(db, q._id, "npp_retired");
      cancelled++;
      continue;
    }
    if (npp.party !== q.targetPartyId) {
      await cancelQueue(db, q._id, "npp_party_changed");
      cancelled++;
      continue;
    }
    const seat = await db.collection<ElectedOfficial>("electedOfficials").findOne({
      nppId: q.targetNppId,
      officeType: getSubNationalLegislatureKey(q.countryId),
      state: q.stateId.toUpperCase(),
    });
    if (!seat) {
      await cancelQueue(db, q._id, "npp_lost_seat");
      cancelled++;
      continue;
    }
    const activeNppBill = await db.collection<StateBill>("stateBills").findOne({
      sponsorNppId: q.targetNppId,
      status: { $nin: STATE_TERMINAL_STATUSES },
    });
    if (activeNppBill) {
      await cancelQueue(db, q._id, "npp_already_has_active_bill");
      cancelled++;
      continue;
    }

    // 2b. Re-validate provisions at fire time (audit S6): queue entries written
    //     before the strict queue-time schema landed (or via any other writer)
    //     must not smuggle unsupported provision types into enactment.
    if (q.provisions?.length) {
      const provisionCheck = z.array(stateBillProvisionSchema).safeParse(q.provisions);
      if (!provisionCheck.success) {
        await cancelQueue(db, q._id, "invalid_provisions");
        cancelled++;
        continue;
      }
    }

    // 3. Fire — insert the StateBill with NPP sponsor + governor metadata.
    // The sponsoring NPP auto-votes "for" on their own bill at fire time so
    // the cross-pressure system in processStateBillVoting skips them (the
    // existingVotes[nppKey] check). This applies to ONLY this NPP — every
    // other party-member NPP still resolves through cross-pressure.
    const sponsorVoteWeight = seat.seatsHeld ?? 1;
    const sponsorVoteKey = `npp_${q.targetNppId.toString()}`;
    const billId = new ObjectId();
    const votingEndsAt = new Date(now.getTime() + VOTING_DURATION_HOURS * 3_600_000);
    const bill: StateBill = {
      _id: billId,
      stateId: q.stateId,
      countryId: q.countryId,
      title: q.title,
      summary: q.summary,
      sponsorId: null,
      sponsorName: q.targetNppName,
      sponsorParty: q.targetPartyId,
      sponsorNppId: q.targetNppId,
      isNPP: true,
      nppId: q.targetNppId,
      proposedByGovernor: {
        characterId: q.governorCharacterId,
        name: q.governorName,
      },
      status: "active",
      votesFor: sponsorVoteWeight,
      votesAgainst: 0,
      votesAbstain: 0,
      votes: { [sponsorVoteKey]: "for" },
      ...(q.category ? { category: q.category } : {}),
      ...(q.legislationTypeId ? { legislationTypeId: q.legislationTypeId } : {}),
      ...(q.effectDirection !== undefined ? { effectDirection: q.effectDirection } : {}),
      ...(q.provisions ? { provisions: q.provisions } : {}),
      proposalActionCost: q.proposalActionCost,
      proposalNpiCost: q.proposalNpiCost,
      proposedAt: now,
      votingStartedAt: now,
      votingEndsAt,
      createdAt: now,
      updatedAt: now,
    };
    await db.collection<StateBill>("stateBills").insertOne(bill);

    await db.collection<GovernorQueuedBill>("governorLegislationQueue").updateOne(
      { _id: q._id, status: "pending" },
      {
        $set: {
          status: "fired",
          firedBillId: billId,
          updatedAt: new Date(),
        },
      }
    );
    fired++;
  }

  return { fired, cancelled };
}

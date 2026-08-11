import type { Db, ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { Coalition, CoalitionMember } from "@/lib/db/types/coalition";

interface AbsorbedPartyRef {
  _id: ObjectId;
  sequentialId: number;
}

interface SurvivingPartyRef {
  _id: ObjectId;
  sequentialId: number;
  chairId?: ObjectId | null;
  viceChairId?: ObjectId | null;
}

/**
 * Collapse a merged-away party's coalition footprint into the surviving
 * (target) party.
 *
 * For every coalition in the country:
 *  - If both the absorbed and the target party are members, drop the absorbed
 *    member (its seats already moved to the target).
 *  - If only the absorbed party is a member, swap its membership slot to the
 *    target (preserving joinedAt) so the coalition keeps the seats.
 *  - If the absorbed party chaired the coalition, hand the chair to the
 *    surviving party's chair (falling back to its vice-chair).
 *  - Strip any pending invites / join requests addressed to the absorbed party.
 *
 * Only writes coalitions that actually changed. Does not disband coalitions
 * that fall below any membership minimum — that is left to coalition lifecycle.
 */
export async function absorbPartyIntoCoalitions(
  db: Db,
  opts: {
    countryId: CountryId;
    proposingParty: AbsorbedPartyRef;
    targetParty: SurvivingPartyRef;
    now: Date;
  }
): Promise<void> {
  const { countryId, proposingParty, targetParty, now } = opts;

  const coalitions = await db.collection<Coalition>("coalitions").find({ countryId }).toArray();

  for (const coalition of coalitions) {
    const members = coalition.members ?? [];
    const pendingInvites = coalition.pendingInvites ?? [];
    const joinRequests = coalition.joinRequests ?? [];

    const hasProposingMember = members.some(
      (m) => m.partySequentialId === proposingParty.sequentialId
    );
    const hasTargetMember = members.some((m) => m.partySequentialId === targetParty.sequentialId);

    let newMembers = members;
    if (hasProposingMember && hasTargetMember) {
      newMembers = members.filter((m) => m.partySequentialId !== proposingParty.sequentialId);
    } else if (hasProposingMember) {
      newMembers = members.map((m): CoalitionMember =>
        m.partySequentialId === proposingParty.sequentialId
          ? {
              partyId: targetParty._id,
              partySequentialId: targetParty.sequentialId,
              joinedAt: m.joinedAt,
            }
          : m
      );
    }

    const newPendingInvites = pendingInvites.filter((i) => !i.partyId.equals(proposingParty._id));
    const newJoinRequests = joinRequests.filter((r) => !r.partyId.equals(proposingParty._id));

    const chairWasProposing = coalition.chairPartyId.equals(proposingParty._id);

    const membersChanged = newMembers !== members;
    const invitesChanged = newPendingInvites.length !== pendingInvites.length;
    const requestsChanged = newJoinRequests.length !== joinRequests.length;

    if (!membersChanged && !invitesChanged && !requestsChanged && !chairWasProposing) {
      continue;
    }

    const set: Record<string, unknown> = {
      members: newMembers,
      pendingInvites: newPendingInvites,
      joinRequests: newJoinRequests,
      updatedAt: now,
    };
    if (chairWasProposing) {
      set.chairPartyId = targetParty._id;
      const newChairCharacter = targetParty.chairId ?? targetParty.viceChairId ?? null;
      if (newChairCharacter) set.chairCharacterId = newChairCharacter;
    }

    await db.collection<Coalition>("coalitions").updateOne({ _id: coalition._id }, { $set: set });
  }
}

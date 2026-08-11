import type { Db, ObjectId } from "mongodb";
import type {
  Corporation,
  CorporationPrivatizationVote,
  PrivatizationVoteCast,
} from "@/lib/db/types";
import { shareholderVotingPower } from "@/lib/corporations/superShares";

export interface CastVoteInput {
  db: Db;
  corporation: Corporation;
  vote: CorporationPrivatizationVote;
  voterCharacterId?: ObjectId;
  voterCorporationId?: ObjectId;
  voteValue: "yes" | "no";
  currentTurn: number;
}

export type CastVoteResult =
  | { ok: false; error: string; status: number }
  | { ok: true; voteShares: number; tally: { yes: number; no: number }; autoResolve: boolean };

/**
 * Cast a yes/no vote on an open privatization buyout vote.
 *
 * - Voter must be a non-CEO character or corporation that holds shares NOW
 *   (re-read from corp.shareholders, no snapshot from earlier in vote)
 * - One effective vote per holder; later casts overwrite earlier ones
 *   (allows changing your mind during the 24-turn window)
 * - voteShares is the holder's current share count at cast time
 */
export async function castPrivatizationVote(input: CastVoteInput): Promise<CastVoteResult> {
  const { db, corporation, vote, voterCharacterId, voterCorporationId, voteValue, currentTurn } =
    input;

  if (vote.status !== "open") {
    return { ok: false, error: "Vote is no longer open", status: 400 };
  }
  if (currentTurn > vote.deadlineAtTurn) {
    return { ok: false, error: "Vote deadline has passed", status: 400 };
  }
  if (voterCharacterId && voterCharacterId.toString() === corporation.ceoId.toString()) {
    return { ok: false, error: "CEO cannot vote in their own privatization", status: 403 };
  }

  const holderEntry = corporation.shareholders.find((s) => {
    if (voterCharacterId) return s.characterId?.toString() === voterCharacterId.toString();
    if (voterCorporationId) return s.corporationId?.toString() === voterCorporationId.toString();
    return false;
  });
  const voteShares = holderEntry?.shares ?? 0;
  if (voteShares <= 0) {
    return { ok: false, error: "You hold no shares in this corporation", status: 403 };
  }

  const newCast: PrivatizationVoteCast = {
    ...(voterCharacterId ? { characterId: voterCharacterId } : {}),
    ...(voterCorporationId ? { corporationId: voterCorporationId } : {}),
    voteShares,
    vote: voteValue,
    castAt: new Date(),
  };

  const filteredVotes = vote.votes.filter((v) => {
    if (voterCharacterId) return v.characterId?.toString() !== voterCharacterId.toString();
    if (voterCorporationId) return v.corporationId?.toString() !== voterCorporationId.toString();
    return true;
  });
  const newVotes = [...filteredVotes, newCast];

  const updateRes = await db
    .collection<CorporationPrivatizationVote>("corporationPrivatizationVotes")
    .updateOne(
      { _id: vote._id, status: "open" },
      { $set: { votes: newVotes, updatedAt: new Date() } }
    );
  if (updateRes.matchedCount === 0) {
    return { ok: false, error: "Vote state changed; retry", status: 409 };
  }

  // Weight each cast by VOTING POWER (supershares count), capped at the shares
  // held when the vote was cast. Mirrors resolvePrivatizationVote so the early
  // auto-resolve can never pass a vote the final tally would fail.
  const votingWeight = (cast: PrivatizationVoteCast): number => {
    const h = corporation.shareholders.find((s) => {
      if (cast.characterId) return s.characterId?.toString() === cast.characterId.toString();
      if (cast.corporationId) return s.corporationId?.toString() === cast.corporationId.toString();
      return false;
    });
    if (!h) return 0;
    const votableShares = Math.min(cast.voteShares, h.shares);
    return shareholderVotingPower(corporation, {
      shares: votableShares,
      superShares: h.superShares,
    });
  };

  const tally = newVotes.reduce(
    (acc, v) => {
      const w = votingWeight(v);
      if (v.vote === "yes") acc.yes += w;
      else acc.no += w;
      return acc;
    },
    { yes: 0, no: 0 }
  );

  // Auto-resolve when yes voting power exceeds 50% of ALL eligible (non-CEO)
  // voting power — not just what's cast so far — meaning the outcome can no
  // longer change. Corp-held shares are excluded: there is no UI path for a
  // corporation to cast a vote, so counting them in the denominator would make
  // auto-resolve unreachable whenever another corporation holds part of the float.
  const ceoIdStr = corporation.ceoId.toString();
  const eligibleVotingPower = corporation.shareholders
    .filter((s) => s.characterId && s.characterId.toString() !== ceoIdStr)
    .reduce((acc, s) => acc + shareholderVotingPower(corporation, s), 0);
  const autoResolve = eligibleVotingPower > 0 && tally.yes * 2 > eligibleVotingPower;

  return { ok: true, voteShares, tally, autoResolve };
}

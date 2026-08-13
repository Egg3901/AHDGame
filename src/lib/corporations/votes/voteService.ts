import type { Db, ObjectId } from "mongodb";
import type { Corporation } from "@/lib/db/types/corporation";
import type { Character } from "@/lib/db/types/character";
import { resolveFundStewardship } from "./fundStewardship";
import type { FundInstruction } from "./fundStewardship";
import type {
  CorporationVote,
  CorporationVoteType,
  CorporationVotePayload,
  CorporationVoteCast,
} from "@/lib/db/types/corporationVote";
import { getLegalStructureForCorp } from "@/lib/corporations/legalStructure";
import { hasSuperShares, isValidSuperShareMultiplier } from "@/lib/corporations/superShares";

export type VoteOutcome = "passed" | "failed" | "open";

/**
 * Fund instructions stored on a vote, keyed the way `resolveFundStewardship`
 * reads them. The last instruction per fund wins, so a director who changes
 * their mind does not need the earlier row removed.
 */
export function fundDirectionsFrom(vote: CorporationVote): Map<string, FundInstruction> {
  const directions = new Map<string, FundInstruction>();
  for (const d of vote.fundDirections ?? []) {
    directions.set(d.fundId.toString(), {
      vote: d.vote,
      directorCharacterId: d.directorCharacterId,
    });
  }
  return directions;
}

export function computeVoteOutcome(opts: {
  yesShares: number;
  totalEligibleShares: number;
  passThreshold: number;
}): "passed" | "failed" {
  const required = Math.ceil(opts.totalEligibleShares * opts.passThreshold);
  return opts.yesShares >= required ? "passed" : "failed";
}

export function checkAutoResolve(opts: {
  yesShares: number;
  noShares: number;
  totalEligibleShares: number;
  passThreshold: number;
}): VoteOutcome {
  const required = Math.ceil(opts.totalEligibleShares * opts.passThreshold);
  if (opts.yesShares >= required) return "passed";
  const maxPossibleYes =
    opts.yesShares + (opts.totalEligibleShares - opts.yesShares - opts.noShares);
  if (maxPossibleYes < required) return "failed";
  return "open";
}

export type OpenVoteResult =
  { ok: true; voteId: string } | { ok: false; error: string; status: number };

export async function openCorporationVote(opts: {
  db: Db;
  corporation: Corporation;
  character: Character;
  currentTurn: number;
  type: CorporationVoteType;
  payload: CorporationVotePayload;
}): Promise<OpenVoteResult> {
  const { db, corporation, character, currentTurn, type, payload } = opts;

  if (corporation.isPrivate) {
    return {
      ok: false,
      error: "Private corporations do not require shareholder votes",
      status: 400,
    };
  }

  if (type === "adopt_supershares") {
    if (hasSuperShares(corporation)) {
      return {
        ok: false,
        error: "This corporation already has a dual-class supershare structure",
        status: 400,
      };
    }
    if (!isValidSuperShareMultiplier(payload.superShareMultiplier)) {
      return { ok: false, error: "Invalid supershare vote multiplier", status: 400 };
    }
    if ((corporation.ceoType ?? "character") !== "character") {
      return {
        ok: false,
        error: "Only corporations with a player character CEO can adopt supershares",
        status: 400,
      };
    }
    const ceoEntry = corporation.shareholders?.find((s) =>
      s.characterId?.equals(corporation.ceoId)
    );
    if (!ceoEntry || ceoEntry.shares <= 0) {
      return {
        ok: false,
        error: "The CEO holds no shares to designate as supershares",
        status: 400,
      };
    }
  }

  const existingVote = await db.collection<CorporationVote>("corporationVotes").findOne({
    corporationId: corporation._id,
    status: "open",
  });
  if (existingVote) {
    const sameType = existingVote.type === type;
    return {
      ok: false,
      error: sameType
        ? "A vote of this type is already in progress"
        : "Another vote is already in progress — resolve it before opening a new one",
      status: 409,
    };
  }

  const privatizationVote = await db.collection("corporationPrivatizationVotes").findOne({
    corporationId: corporation._id,
    status: "open",
  });
  if (privatizationVote) {
    return {
      ok: false,
      error: "Cannot open a vote while a privatization vote is in progress",
      status: 409,
    };
  }

  const legalStructure = getLegalStructureForCorp(corporation);
  const now = new Date();
  const doc: Omit<CorporationVote, "_id"> = {
    corporationId: corporation._id,
    type,
    proposedByCharacterId: character._id,
    proposedAtTurn: currentTurn,
    deadlineAtTurn: currentTurn + 24,
    status: "open",
    passThreshold: legalStructure.shareholderVoteThreshold,
    payload,
    votes: [],
    createdAt: now,
    updatedAt: now,
  };

  const result = await db
    .collection<Omit<CorporationVote, "_id">>("corporationVotes")
    .insertOne(doc);
  return { ok: true, voteId: result.insertedId.toHexString() };
}

export type CastVoteResult = { ok: true } | { ok: false; error: string; status: number };

export async function castCorporationVote(opts: {
  db: Db;
  vote: CorporationVote;
  voterId: ObjectId;
  voterType: "character" | "corporation";
  voteShares: number;
  choice: "yes" | "no";
}): Promise<CastVoteResult> {
  const { db, vote, voterId, voterType, voteShares, choice } = opts;

  if (vote.status !== "open")
    return { ok: false, error: "This vote is no longer open", status: 409 };
  if (voteShares <= 0)
    return { ok: false, error: "You hold no shares in this corporation", status: 403 };

  const voterField = voterType === "character" ? "characterId" : "corporationId";
  const cast: CorporationVoteCast = {
    ...(voterType === "character" ? { characterId: voterId } : { corporationId: voterId }),
    voteShares,
    vote: choice,
    castAt: new Date(),
  };

  await db.collection<CorporationVote>("corporationVotes").updateOne({ _id: vote._id }, [
    {
      $set: {
        votes: {
          $concatArrays: [
            { $filter: { input: "$votes", cond: { $ne: [`$$this.${voterField}`, voterId] } } },
            [cast],
          ],
        },
        updatedAt: new Date(),
      },
    },
  ]);
  return { ok: true };
}

export async function cancelCorporationVote(opts: {
  db: Db;
  vote: CorporationVote;
}): Promise<void> {
  const now = new Date();
  await opts.db
    .collection<CorporationVote>("corporationVotes")
    .updateOne(
      { _id: opts.vote._id },
      { $set: { status: "cancelled", resolvedAt: now, updatedAt: now } }
    );
}

/**
 * Lazy resolver for a single corp vote. Idempotent: parallel callers will
 * compute the same outcome but only ONE wins the atomic status flip. Callers
 * MUST gate side effects (notifications, applyPassedVoteEffects) on
 * `claimed === true` — otherwise double-apply will issue shares / dilute caps
 * twice.
 */
export async function resolveCorporationVoteIfReady(opts: {
  db: Db;
  vote: CorporationVote;
  totalEligibleShares: number;
  currentTurn: number;
}): Promise<{ outcome: VoteOutcome; claimed: boolean }> {
  const { db, vote, totalEligibleShares, currentTurn } = opts;

  if (vote.status !== "open") return { outcome: vote.status as VoteOutcome, claimed: false };

  const castYes = vote.votes.filter((v) => v.vote === "yes").reduce((s, v) => s + v.voteShares, 0);
  const castNo = vote.votes.filter((v) => v.vote === "no").reduce((s, v) => s + v.voteShares, 0);

  // Fund stewardship: index funds hold real stakes that already sit in the
  // denominator but could never be cast, so a fund-heavy corporation drifted
  // toward permanent deadlock. Directed funds follow their controlling unit
  // holder; passive ones mirror the majority actually cast; a fund with neither
  // abstains AND drops out of the denominator, because measuring a threshold
  // against shares nobody can cast is what caused the deadlock.
  const corporation = await db
    .collection<Corporation>("corporations")
    .findOne({ _id: vote.corporationId });
  const stewardship = corporation
    ? await resolveFundStewardship(db, {
        corporation,
        castYes,
        castNo,
        directions: fundDirectionsFrom(vote),
      })
    : { yes: 0, no: 0, excludedFromDenominator: 0 };

  const yesShares = castYes + stewardship.yes;
  const noShares = castNo + stewardship.no;
  const eligibleShares = Math.max(1, totalEligibleShares - stewardship.excludedFromDenominator);

  let outcome: VoteOutcome;
  if (currentTurn < vote.deadlineAtTurn) {
    outcome = checkAutoResolve({
      yesShares,
      noShares,
      totalEligibleShares: eligibleShares,
      passThreshold: vote.passThreshold,
    });
    if (outcome === "open") return { outcome: "open", claimed: false };
  } else {
    outcome = computeVoteOutcome({
      yesShares,
      totalEligibleShares: eligibleShares,
      passThreshold: vote.passThreshold,
    });
  }

  // Atomic claim: only one caller wins the open→terminal transition. The
  // loser sees matchedCount === 0 and must not apply side effects.
  const now = new Date();
  const claim = await db
    .collection<CorporationVote>("corporationVotes")
    .updateOne(
      { _id: vote._id, status: "open" },
      { $set: { status: outcome, resolvedAt: now, updatedAt: now } }
    );
  return { outcome, claimed: claim.matchedCount > 0 };
}

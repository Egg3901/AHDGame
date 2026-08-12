import type { Db, ObjectId } from "mongodb";
import type { Corporation, IndexFund, IndexFundPosition, Shareholder } from "@/lib/db/types";
import { shareholderVotingPower } from "@/lib/corporations/superShares";

/**
 * Index-fund stewardship: how a fund votes the shares it holds.
 *
 * Funds hold real stakes and those stakes already count in `totalVotingPower`,
 * which is the denominator every pass threshold is measured against. But the
 * vote path only ever accepted `character` and `corporation` voters, so a fund's
 * shares could never be cast. The effect was that funds DILUTED every corporate
 * vote and decided none: the more of a company an index fund absorbed, the
 * harder it became for its actual owners to pass anything, and the closer the
 * corporation drifted toward permanent deadlock.
 *
 * A fund is not a person and has no opinion, so its ballot has to come from
 * somewhere principled:
 *
 *  1. **Directed** - a unit holder large enough to control the fund's mandate
 *     (>= `STEWARDSHIP_DIRECTION_THRESHOLD` of units) has their instruction
 *     followed. This is the route by which buying fund units becomes a route to
 *     corporate influence, which is the point of the feature. Instructions are
 *     written per vote by the fund-direction route and read back through
 *     `fundDirectionsFrom`; directorship is re-verified HERE at resolve time,
 *     so an instruction from someone who has since sold down does not bind and
 *     does not transfer to whoever bought control after it was given.
 *  2. **Mirror** — otherwise the fund votes with the majority of the votes
 *     actually cast by everyone else. A passive fund follows the owners rather
 *     than overriding them, so it stops being a blocking stake without becoming
 *     a kingmaker.
 *  3. **Abstain** — if nobody else voted, there is no majority to mirror and no
 *     director, so the fund's shares sit out AND come out of the denominator
 *     (see `stewardshipBallot`). Leaving them in would recreate the deadlock
 *     this fixes.
 */

/** Share of a fund's units that lets a holder direct its stewardship vote. */
export const STEWARDSHIP_DIRECTION_THRESHOLD = 0.5;

export type StewardshipBallot =
  | { kind: "directed"; vote: "yes" | "no"; votingPower: number; directorId: ObjectId }
  | { kind: "mirror"; vote: "yes" | "no"; votingPower: number }
  | { kind: "abstain"; votingPower: 0; excludedFromDenominator: number };

/** One fund's instruction, with the holder who gave it. */
export interface FundInstruction {
  vote: "yes" | "no";
  directorCharacterId: ObjectId;
}

export interface FundStake {
  fundId: ObjectId;
  /** Voting power of the fund's holding in the corporation being voted on. */
  votingPower: number;
}

/** Fund-held stakes in a corporation, with their voting power resolved. */
export function fundStakesIn(corporation: Corporation): FundStake[] {
  const stakes: FundStake[] = [];
  for (const holder of corporation.shareholders ?? []) {
    if (!holder.fundId) continue;
    const power = shareholderVotingPower(corporation, holder as Shareholder);
    if (power > 0) stakes.push({ fundId: holder.fundId, votingPower: power });
  }
  return stakes;
}

/**
 * Decide one fund's ballot.
 *
 * `castYes`/`castNo` are the votes already cast by non-fund holders. A tie is
 * treated as no majority: mirroring a tie would let the fund break it, which is
 * exactly the kingmaker behaviour a passive vehicle should not have.
 */
export function stewardshipBallot(params: {
  votingPower: number;
  castYes: number;
  castNo: number;
  direction?: { holderId: ObjectId; unitShare: number; vote: "yes" | "no" } | null;
}): StewardshipBallot {
  const { votingPower, castYes, castNo, direction } = params;

  if (direction && direction.unitShare >= STEWARDSHIP_DIRECTION_THRESHOLD) {
    return {
      kind: "directed",
      vote: direction.vote,
      votingPower,
      directorId: direction.holderId,
    };
  }

  if (castYes > castNo) return { kind: "mirror", vote: "yes", votingPower };
  if (castNo > castYes) return { kind: "mirror", vote: "no", votingPower };

  return { kind: "abstain", votingPower: 0, excludedFromDenominator: votingPower };
}

/**
 * The unit holder able to direct a fund, if any. Largest holder by units, and
 * only when they clear the threshold; `fund_reserve` is the fund's own float and
 * is never a director.
 */
export async function loadFundDirector(
  db: Db,
  fundId: ObjectId
): Promise<{ holderId: ObjectId; unitShare: number } | null> {
  const positions = await db
    .collection<IndexFundPosition>("indexFundPositions")
    .find(
      { fundId, units: { $gt: 0 } },
      { projection: { holderKind: 1, characterId: 1, units: 1 } }
    )
    .toArray();

  const holders = positions.filter((p) => p.holderKind === "character" && p.characterId);
  const totalUnits = positions.reduce((sum, p) => sum + (p.units ?? 0), 0);
  if (totalUnits <= 0 || holders.length === 0) return null;

  const largest = holders.reduce((best, p) => ((p.units ?? 0) > (best.units ?? 0) ? p : best));
  const unitShare = (largest.units ?? 0) / totalUnits;
  if (unitShare < STEWARDSHIP_DIRECTION_THRESHOLD) return null;

  return { holderId: largest.characterId!, unitShare };
}

/**
 * Resolve every fund stake in a corporation into ballots.
 *
 * Returns the voting power to add to each side and the power to REMOVE from the
 * denominator for abstaining funds, so a vote is measured against shares that
 * could actually be cast.
 */
export async function resolveFundStewardship(
  db: Db,
  params: {
    corporation: Corporation;
    castYes: number;
    castNo: number;
    /** Per-fund instruction from its directing unit holder, when one exists. */
    directions?: Map<string, FundInstruction>;
  }
): Promise<{ yes: number; no: number; excludedFromDenominator: number }> {
  const stakes = fundStakesIn(params.corporation);
  if (stakes.length === 0) return { yes: 0, no: 0, excludedFromDenominator: 0 };

  let yes = 0;
  let no = 0;
  let excludedFromDenominator = 0;

  for (const stake of stakes) {
    const instruction = params.directions?.get(stake.fundId.toString());
    const director = instruction ? await loadFundDirector(db, stake.fundId) : null;

    // The instruction binds only if the character who gave it is STILL the
    // controlling holder. Checking that a director merely exists would hand the
    // old holder's instruction to whoever bought control after it was given.
    const stillInControl =
      director != null &&
      instruction != null &&
      director.holderId.equals(instruction.directorCharacterId);

    const ballot = stewardshipBallot({
      votingPower: stake.votingPower,
      castYes: params.castYes,
      castNo: params.castNo,
      direction:
        stillInControl && director && instruction
          ? { holderId: director.holderId, unitShare: director.unitShare, vote: instruction.vote }
          : null,
    });

    if (ballot.kind === "abstain") {
      excludedFromDenominator += ballot.excludedFromDenominator;
    } else if (ballot.vote === "yes") {
      yes += ballot.votingPower;
    } else {
      no += ballot.votingPower;
    }
  }

  return { yes, no, excludedFromDenominator };
}

export interface DirectableFund {
  fundId: ObjectId;
  name: string;
  tickerSymbol: string;
  /** The director's share of the fund's units, at the time of the check. */
  unitShare: number;
  /** The fund's voting power in the corporation being voted on. */
  votingPower: number;
}

/**
 * The funds holding shares in this corporation that `characterId` can direct.
 *
 * This is the read side of the instruction surface: it answers "which of these
 * funds do I control, and how much does each one carry into this vote". The
 * write path authorizes against the same check, and `resolveFundStewardship`
 * re-runs `loadFundDirector` at resolve time, so an instruction from someone who
 * has since fallen below the threshold is ignored rather than honoured.
 */
export async function directableFundsFor(
  db: Db,
  corporation: Corporation,
  characterId: ObjectId
): Promise<DirectableFund[]> {
  const stakes = fundStakesIn(corporation);
  if (stakes.length === 0) return [];

  const directable: { stake: FundStake; unitShare: number }[] = [];
  for (const stake of stakes) {
    const director = await loadFundDirector(db, stake.fundId);
    if (director && director.holderId.equals(characterId)) {
      directable.push({ stake, unitShare: director.unitShare });
    }
  }
  if (directable.length === 0) return [];

  const funds = await db
    .collection<IndexFund>("indexFunds")
    .find(
      { _id: { $in: directable.map((d) => d.stake.fundId) } },
      { projection: { name: 1, tickerSymbol: 1 } }
    )
    .toArray();
  const byId = new Map(funds.map((f) => [f._id.toString(), f]));

  return directable.map((d) => {
    const fund = byId.get(d.stake.fundId.toString());
    return {
      fundId: d.stake.fundId,
      name: fund?.name ?? "Index fund",
      tickerSymbol: fund?.tickerSymbol ?? "",
      unitShare: d.unitShare,
      votingPower: d.stake.votingPower,
    };
  });
}

export type { IndexFund };

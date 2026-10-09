/**
 * Iteration referral contest: counts referrals from one iteration change to the
 * next. When the world moves to a new iteration (runIterationReferrals), or
 * when staff close it by hand (awardReferralContest), the top three referrers
 * get Supporter for the whole next iteration, the previous winners' contest
 * Supporter ends, and the count restarts.
 */
import type { Db } from "mongodb";
import type { Character, GameConfig, User } from "@/lib/db/types";
import type { ContestWinner } from "@/lib/db/types/contestRound";
import { applyPatreonStatus } from "@/lib/patreon/service";
import { createNotification } from "@/lib/notifications";
import { getContestRoundsCollection } from "./collection";
import {
  contestRoundId,
  iterationChanged,
  rankReferralWinners,
  referralGrantDecision,
} from "./rules";

export class ReferralAwardError extends Error {}

const ITERATION_KIND = "referrals_iteration" as const;

export interface ReferralAwardInput {
  /** Staff username, or "system" for the automatic award at an iteration change. */
  awardedBy: string;
  now?: Date;
  /** Iteration the next contest runs in. */
  iterationKey?: string;
}

export interface ReferralAwardResult {
  roundId: string;
  winners: ContestWinner[];
  /** Account usernames in winner order, for the staff log only. */
  usernames: string[];
  /** Earlier winners whose contest Supporter ended. */
  revoked: number;
  restartedAt: Date;
}

/** Candidates beyond the top three are loaded so banned leaders can be skipped. */
const CANDIDATE_POOL = 20;

async function nextRoundNumber(db: Db): Promise<number> {
  const last = await getContestRoundsCollection(db)
    .find({ kind: ITERATION_KIND }, { projection: { roundNumber: 1 } })
    .sort({ roundNumber: -1 })
    .limit(1)
    .toArray();
  return (last[0]?.roundNumber ?? 0) + 1;
}

async function openIterationRound(
  db: Db,
  roundNumber: number,
  startedAt: Date,
  iterationKey: string | undefined
): Promise<void> {
  try {
    await getContestRoundsCollection(db).insertOne({
      _id: contestRoundId(ITERATION_KIND, roundNumber),
      kind: ITERATION_KIND,
      roundNumber,
      status: "active",
      startedAt,
      endsAt: startedAt,
      startTurn: 0,
      ...(iterationKey ? { iterationKey } : {}),
      baselines: [],
      standings: [],
      winners: [],
    });
  } catch (err) {
    // Duplicate id: another process opened this round first.
    if ((err as { code?: number }).code !== 11000) throw err;
  }
}

export async function awardReferralContest(
  db: Db,
  input: ReferralAwardInput
): Promise<ReferralAwardResult> {
  const now = input.now ?? new Date();
  const rounds = getContestRoundsCollection(db);
  const [config, active] = await Promise.all([
    db
      .collection<GameConfig>("gameConfig")
      .findOne({ _id: "default" }, { projection: { referralContestStartedAt: 1 } }),
    rounds.findOne({ kind: ITERATION_KIND, status: "active" }),
  ]);
  const startedAt = active?.startedAt ?? config?.referralContestStartedAt;
  if (!(startedAt instanceof Date)) {
    throw new ReferralAwardError("No referral contest is running");
  }

  // Claim the round before touching anyone's benefits, so two awards can
  // never run for the same contest.
  const roundNumber = active ? active.roundNumber : await nextRoundNumber(db);
  const roundId = contestRoundId(ITERATION_KIND, roundNumber);
  if (active) {
    const claim = await rounds.updateOne(
      { _id: active._id, status: "active" },
      { $set: { status: "settled", settledAt: now, endsAt: now } }
    );
    if (claim.modifiedCount !== 1) {
      throw new ReferralAwardError("This contest was already awarded");
    }
  } else {
    try {
      await rounds.insertOne({
        _id: roundId,
        kind: ITERATION_KIND,
        roundNumber,
        status: "settled",
        startedAt,
        endsAt: now,
        startTurn: 0,
        settledAt: now,
        baselines: [],
        standings: [],
        winners: [],
      });
    } catch (err) {
      if ((err as { code?: number }).code === 11000) {
        throw new ReferralAwardError("This contest was already awarded");
      }
      throw err;
    }
  }

  const users = await db
    .collection<User>("users")
    .find({ referralContestCount: { $gt: 0 } })
    .project<
      Pick<
        User,
        | "_id"
        | "username"
        | "referralContestCount"
        | "isBanned"
        | "patreonTier"
        | "patreonExpiresAt"
        | "supporterProvider"
      >
    >({
      _id: 1,
      username: 1,
      referralContestCount: 1,
      isBanned: 1,
      patreonTier: 1,
      patreonExpiresAt: 1,
      supporterProvider: 1,
    })
    .sort({ referralContestCount: -1, username: 1 })
    .limit(CANDIDATE_POOL)
    .toArray();
  const byId = new Map(users.map((u) => [u._id.toString(), u]));
  const ranked = rankReferralWinners(
    users.map((u) => ({
      userId: u._id.toString(),
      username: u.username,
      count: u.referralContestCount ?? 0,
      banned: u.isBanned === true,
    }))
  );
  const winnerIds = new Set(ranked.map((r) => r.userId));

  // The last winners had their iteration; it ends now unless they won again.
  const previous = await db
    .collection<User>("users")
    .find({ supporterProvider: "contest" }, { projection: { _id: 1 } })
    .toArray();
  const toRevoke = previous.filter((u) => !winnerIds.has(u._id.toString())).map((u) => u._id);
  let revoked = 0;
  if (toRevoke.length > 0) {
    const res = await db.collection<User>("users").updateMany(
      { _id: { $in: toRevoke }, supporterProvider: "contest" },
      {
        $set: { patreonTier: null, supporterProvider: null, patreonExpiresAt: now },
        $unset: { patreonProfileBorder: "", patreonHighlightColor: "" },
      }
    );
    revoked = res.modifiedCount;
  }

  const characters = await db
    .collection<Character>("characters")
    .find(
      { userId: { $in: ranked.map((r) => byId.get(r.userId)!._id) } },
      { projection: { _id: 1, userId: 1, name: 1 } }
    )
    .toArray();
  const characterByUser = new Map(characters.map((c) => [c.userId.toString(), c]));

  const winners: ContestWinner[] = [];
  for (const [index, candidate] of ranked.entries()) {
    const user = byId.get(candidate.userId)!;
    const decision = referralGrantDecision(
      {
        tier: user.patreonTier ?? null,
        expiresAtMs: user.patreonExpiresAt ? new Date(user.patreonExpiresAt).getTime() : null,
        provider: user.supporterProvider ?? null,
      },
      now.getTime()
    );
    if (decision === "grant") {
      // No end date: the next iteration's award ends it.
      await applyPatreonStatus(db, {
        userId: user._id,
        tier: "supporter",
        expiresAt: null,
        adsDisabledDefault: true,
        provider: "contest",
      });
    }
    await createNotification({
      userId: user._id,
      type: "system",
      title: "You placed in the referral contest",
      message:
        decision === "already_supporter"
          ? `You finished #${index + 1} with ${candidate.count} referrals. Thank you for bringing new players in.`
          : `You finished #${index + 1} with ${candidate.count} referrals. Supporter benefits are yours for the whole next iteration.`,
      metadata: { href: "/contests" },
    });
    const character = characterByUser.get(candidate.userId);
    winners.push({
      rank: index + 1,
      characterId: character?._id.toString() ?? "",
      characterName: character?.name ?? "",
      subjectId: candidate.userId,
      // Public record: account usernames are never shown, only character names.
      subjectName: character?.name ?? "",
      score: candidate.count,
      alreadySupporter: decision === "already_supporter",
    });
  }

  await Promise.all([
    rounds.updateOne(
      { _id: roundId },
      {
        $set: {
          winners,
          awardedBy: input.awardedBy,
          winnerUserIds: ranked.map((r) => byId.get(r.userId)!._id),
        },
      }
    ),
    db
      .collection<GameConfig>("gameConfig")
      .updateOne({ _id: "default" }, { $set: { referralContestStartedAt: now } }),
    db.collection("users").updateMany({}, { $set: { referralContestCount: 0 } }),
    openIterationRound(db, roundNumber + 1, now, input.iterationKey ?? active?.iterationKey),
  ]);

  return {
    roundId,
    winners,
    usernames: ranked.map((r) => r.username),
    revoked,
    restartedAt: now,
  };
}

/**
 * Post-turn step: keep an iteration referral contest running, and award it the
 * first time the world reports a different iteration. On first run it adopts
 * the referral window already counting, without awarding.
 */
export async function runIterationReferrals(
  db: Db,
  iterationKey: string | undefined,
  now: Date
): Promise<"opened" | "awarded" | "running"> {
  const rounds = getContestRoundsCollection(db);
  const active = await rounds.findOne({ kind: ITERATION_KIND, status: "active" });

  if (!active) {
    const config = await db
      .collection<GameConfig>("gameConfig")
      .findOne({ _id: "default" }, { projection: { referralContestStartedAt: 1 } });
    let startedAt = config?.referralContestStartedAt;
    if (!(startedAt instanceof Date)) {
      startedAt = now;
      await db
        .collection<GameConfig>("gameConfig")
        .updateOne({ _id: "default" }, { $set: { referralContestStartedAt: now } });
    }
    await openIterationRound(db, await nextRoundNumber(db), startedAt, iterationKey);
    return "opened";
  }

  if (!active.iterationKey && iterationKey) {
    await rounds.updateOne({ _id: active._id, status: "active" }, { $set: { iterationKey } });
    return "running";
  }

  if (iterationChanged(active.iterationKey, iterationKey)) {
    await awardReferralContest(db, { awardedBy: "system", now, iterationKey });
    return "awarded";
  }
  return "running";
}

/**
 * Referral contest award: when staff close an iteration's referral contest,
 * the top three referrers (rankReferralWinners) get Supporter benefits until a
 * chosen date and the contest restarts from zero (awardReferralContest).
 */
import type { Db } from "mongodb";
import type { Character, GameConfig, User } from "@/lib/db/types";
import type { ContestWinner } from "@/lib/db/types/contestRound";
import { applyPatreonStatus } from "@/lib/patreon/service";
import { createNotification } from "@/lib/notifications";
import { getContestRoundsCollection } from "./collection";
import { contestRoundId, rankReferralWinners, referralGrantDecision } from "./rules";

export class ReferralAwardError extends Error {}

export interface ReferralAwardInput {
  supporterUntil: Date;
  adminUsername: string;
  now?: Date;
}

export interface ReferralAwardResult {
  roundId: string;
  winners: ContestWinner[];
  /** Account usernames in winner order, for the staff log only. */
  usernames: string[];
  restartedAt: Date;
}

/** Candidates beyond the top three are loaded so banned leaders can be skipped. */
const CANDIDATE_POOL = 20;

export async function awardReferralContest(
  db: Db,
  input: ReferralAwardInput
): Promise<ReferralAwardResult> {
  const now = input.now ?? new Date();
  if (input.supporterUntil.getTime() <= now.getTime()) {
    throw new ReferralAwardError("Supporter end date must be in the future");
  }

  const config = await db
    .collection<GameConfig>("gameConfig")
    .findOne({ _id: "default" }, { projection: { referralContestStartedAt: 1 } });
  const startedAt = config?.referralContestStartedAt;
  if (!(startedAt instanceof Date)) {
    throw new ReferralAwardError("No referral contest is running");
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
      now.getTime(),
      input.supporterUntil.getTime()
    );
    if (decision !== "already_supporter") {
      await applyPatreonStatus(db, {
        userId: user._id,
        tier: decision === "extend" ? (user.patreonTier ?? "supporter") : "supporter",
        expiresAt: input.supporterUntil,
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
          : `You finished #${index + 1} with ${candidate.count} referrals. Supporter benefits are yours until ${input.supporterUntil.toDateString()}.`,
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
      supporterUntil: input.supporterUntil,
      alreadySupporter: decision === "already_supporter",
    });
  }

  const rounds = getContestRoundsCollection(db);
  const previous = await rounds
    .find({ kind: "referrals" }, { projection: { roundNumber: 1 } })
    .sort({ roundNumber: -1 })
    .limit(1)
    .toArray();
  const roundNumber = (previous[0]?.roundNumber ?? 0) + 1;
  const roundId = contestRoundId("referrals", roundNumber);
  await rounds.insertOne({
    _id: roundId,
    kind: "referrals",
    roundNumber,
    status: "settled",
    startedAt,
    endsAt: now,
    startTurn: 0,
    settledAt: now,
    baselines: [],
    standings: [],
    winners,
    awardedBy: input.adminUsername,
    winnerUserIds: ranked.map((r) => byId.get(r.userId)!._id),
  });

  await Promise.all([
    db
      .collection<GameConfig>("gameConfig")
      .updateOne({ _id: "default" }, { $set: { referralContestStartedAt: now } }),
    db.collection("users").updateMany({}, { $set: { referralContestCount: 0 } }),
  ]);

  return {
    roundId,
    winners,
    usernames: ranked.map((r) => r.username),
    restartedAt: now,
  };
}

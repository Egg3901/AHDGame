/**
 * Iteration referral contest award: the top three referrers of the iteration
 * (from the contest's stored standings) get Supporter for the whole next
 * iteration, and the previous winners' contest Supporter ends
 * (awardReferralContest). The engine opens the next contest.
 */
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import type { GameConfig, User } from "@/lib/db/types";
import type { ContestWinner } from "@/lib/db/types/contestRound";
import { applyPatreonStatus } from "@/lib/patreon/service";
import { createNotification } from "@/lib/notifications";
import { getContestRoundsCollection } from "./collection";
import { REFERRAL_AWARD_WINNERS, referralGrantDecision } from "./rules";

export class ReferralAwardError extends Error {}

export interface ReferralAwardInput {
  /** Staff username, or "system" for the automatic award at an iteration change. */
  awardedBy: string;
  now?: Date;
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

export async function awardReferralContest(
  db: Db,
  input: ReferralAwardInput
): Promise<ReferralAwardResult> {
  const now = input.now ?? new Date();
  const rounds = getContestRoundsCollection(db);
  const active = await rounds.findOne({ kind: "referrals_iteration", status: "active" });
  if (!active) throw new ReferralAwardError("No referral contest is running");

  // Claim the contest before touching anyone's benefits, so two awards can
  // never run for the same contest.
  const claim = await rounds.updateOne(
    { _id: active._id, status: "active" },
    { $set: { status: "settled", settledAt: now, endsAt: now } }
  );
  if (claim.modifiedCount !== 1) {
    throw new ReferralAwardError("This contest was already awarded");
  }

  // Standings are already ranked, alt-filtered and limited to live players.
  const placed = active.standings.filter((s) => s.score > 0).slice(0, REFERRAL_AWARD_WINNERS);
  const users = await db
    .collection<User>("users")
    .find(
      { _id: { $in: placed.map((s) => new ObjectId(s.subjectId)) } },
      {
        projection: {
          _id: 1,
          username: 1,
          isBanned: 1,
          patreonTier: 1,
          patreonExpiresAt: 1,
          supporterProvider: 1,
        },
      }
    )
    .toArray();
  const byId = new Map(users.map((u) => [u._id.toString(), u]));
  const ranked = placed.filter((s) => {
    const user = byId.get(s.subjectId);
    return user && user.isBanned !== true;
  });
  const winnerIds = new Set(ranked.map((s) => s.subjectId));

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

  const winners: ContestWinner[] = [];
  for (const [index, standing] of ranked.entries()) {
    const user = byId.get(standing.subjectId)!;
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
          ? `You finished #${index + 1} with ${standing.score} referrals. Thank you for bringing new players in.`
          : `You finished #${index + 1} with ${standing.score} referrals. Supporter benefits are yours for the whole next iteration.`,
      metadata: { href: "/contests" },
    });
    winners.push({
      rank: index + 1,
      characterId: standing.characterId,
      characterName: standing.characterName,
      subjectId: standing.subjectId,
      // Public record: account usernames are never shown, only character names.
      subjectName: standing.characterName,
      score: standing.score,
      alreadySupporter: decision === "already_supporter",
    });
  }

  await Promise.all([
    rounds.updateOne(
      { _id: active._id },
      {
        $set: {
          winners,
          awardedBy: input.awardedBy,
          winnerUserIds: ranked.map((s) => new ObjectId(s.subjectId)),
        },
      }
    ),
    // Keep the staff referral tracker's own counter in step with the contest.
    db
      .collection<GameConfig>("gameConfig")
      .updateOne({ _id: "default" }, { $set: { referralContestStartedAt: now } }),
    db.collection("users").updateMany({}, { $set: { referralContestCount: 0 } }),
  ]);

  return {
    roundId: active._id,
    winners,
    usernames: ranked.map((s) => byId.get(s.subjectId)!.username),
    revoked,
    restartedAt: now,
  };
}

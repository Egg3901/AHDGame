/**
 * Read model for the Contests page: live weekly rounds with their leaders and
 * the viewer's own standing, recent winners, and the referral leaderboard
 * (loadContestsPage).
 */
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import type { Character, GameConfig, User } from "@/lib/db/types";
import type {
  ContestKind,
  ContestRecordKind,
  ContestStanding,
  ContestWinner,
} from "@/lib/db/types/contestRound";
import { getGameStatePreset } from "@/lib/db/collections/gameState";
import { getContestRoundsCollection } from "./collection";
import { CONTEST_KINDS, contestPrizeAnchor, rankReferralWinners } from "./rules";

const LEADERS_SHOWN = 10;
const PAST_ROUNDS_SHOWN = 12;
const REFERRAL_POOL = 25;

export interface ContestCardData {
  kind: ContestKind;
  roundNumber: number;
  startedAt: string;
  endsAt: string;
  entrants: number;
  leaders: Array<ContestStanding & { rank: number }>;
  /** Viewer's best entry this round, when they have one. */
  viewer: (ContestStanding & { rank: number }) | null;
}

export interface PastRoundData {
  id: string;
  kind: ContestRecordKind;
  roundNumber: number;
  settledAt: string;
  winners: ContestWinner[];
}

export interface ReferralBoardData {
  running: boolean;
  startedAt: string | null;
  leaders: Array<{ rank: number; name: string; count: number }>;
  viewerCount: number | null;
  viewerRank: number | null;
}

export interface ContestsPageData {
  prizeAnchor: number;
  contests: ContestCardData[];
  past: PastRoundData[];
  referrals: ReferralBoardData;
}

export interface ContestsViewer {
  userId: string;
  characterId: string | null;
}

export async function loadContestsPage(
  db: Db,
  viewer: ContestsViewer | null
): Promise<ContestsPageData> {
  const rounds = getContestRoundsCollection(db);
  const [preset, active, past, referrals] = await Promise.all([
    getGameStatePreset(db),
    rounds.find({ status: "active" }, { projection: { baselines: 0 } }).toArray(),
    rounds
      .find(
        { status: "settled", "winners.0": { $exists: true } },
        { projection: { kind: 1, roundNumber: 1, settledAt: 1, winners: 1 } }
      )
      .sort({ settledAt: -1 })
      .limit(PAST_ROUNDS_SHOWN)
      .toArray(),
    loadReferralBoard(db, viewer),
  ]);

  const byKind = new Map(active.map((r) => [r.kind, r]));
  const contests: ContestCardData[] = [];
  for (const kind of CONTEST_KINDS) {
    const round = byKind.get(kind);
    if (!round) continue;
    const ranked = round.standings.map((s, i) => ({ ...s, rank: i + 1 }));
    const viewerEntry = viewer?.characterId
      ? (ranked.find((s) => s.characterId === viewer.characterId) ?? null)
      : null;
    contests.push({
      kind,
      roundNumber: round.roundNumber,
      startedAt: round.startedAt.toISOString(),
      endsAt: round.endsAt.toISOString(),
      entrants: ranked.length,
      leaders: ranked.slice(0, LEADERS_SHOWN),
      viewer: viewerEntry,
    });
  }

  return {
    prizeAnchor: contestPrizeAnchor(preset),
    contests,
    past: past.map((r) => ({
      id: r._id,
      kind: r.kind,
      roundNumber: r.roundNumber,
      settledAt: (r.settledAt ?? new Date(0)).toISOString(),
      winners: r.winners,
    })),
    referrals,
  };
}

async function loadReferralBoard(
  db: Db,
  viewer: ContestsViewer | null
): Promise<ReferralBoardData> {
  const config = await db
    .collection<GameConfig>("gameConfig")
    .findOne({ _id: "default" }, { projection: { referralContestStartedAt: 1 } });
  const startedAt = config?.referralContestStartedAt;
  if (!(startedAt instanceof Date)) {
    return { running: false, startedAt: null, leaders: [], viewerCount: null, viewerRank: null };
  }

  const users = await db
    .collection<User>("users")
    .find({ referralContestCount: { $gt: 0 } })
    .project<Pick<User, "_id" | "username" | "referralContestCount" | "isBanned">>({
      _id: 1,
      username: 1,
      referralContestCount: 1,
      isBanned: 1,
    })
    .sort({ referralContestCount: -1, username: 1 })
    .limit(REFERRAL_POOL)
    .toArray();
  const ranked = rankReferralWinners(
    users.map((u) => ({
      userId: u._id.toString(),
      username: u.username,
      count: u.referralContestCount ?? 0,
      banned: u.isBanned === true,
    })),
    LEADERS_SHOWN
  );

  const characters = await db
    .collection<Character>("characters")
    .find(
      { userId: { $in: ranked.map((r) => new ObjectId(r.userId)) } },
      { projection: { userId: 1, name: 1 } }
    )
    .toArray();
  const nameByUser = new Map(characters.map((c) => [c.userId.toString(), c.name]));

  let viewerCount: number | null = null;
  let viewerRank: number | null = null;
  if (viewer) {
    const idx = ranked.findIndex((r) => r.userId === viewer.userId);
    if (idx >= 0) {
      viewerRank = idx + 1;
      viewerCount = ranked[idx].count;
    } else {
      const me = await db
        .collection<User>("users")
        .findOne({ _id: new ObjectId(viewer.userId) }, { projection: { referralContestCount: 1 } });
      viewerCount = me?.referralContestCount ?? 0;
    }
  }

  return {
    running: true,
    startedAt: startedAt.toISOString(),
    // Account usernames stay private: a referrer is shown by character name.
    leaders: ranked.map((r, i) => ({
      rank: i + 1,
      name: nameByUser.get(r.userId) ?? "",
      count: r.count,
    })),
    viewerCount,
    viewerRank,
  };
}

/**
 * Read model for the Contests page: live weekly rounds with their leaders and
 * the viewer's own standing, recent winners, and the referral leaderboard
 * (loadContestsPage).
 */
import type { Db } from "mongodb";
import type {
  ContestKind,
  ContestRecordKind,
  ContestStanding,
  ContestWinner,
} from "@/lib/db/types/contestRound";
import { getGameStatePreset } from "@/lib/db/collections/gameState";
import { getContestRoundsCollection } from "./collection";
import { CONTEST_KINDS, contestPrizeAnchor } from "./rules";

const LEADERS_SHOWN = 10;
const PAST_ROUNDS_SHOWN = 12;

export interface ContestCardData {
  kind: ContestKind;
  /** Cash prize for this round's winner, in ₳. */
  prizeAnchor: number;
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
  /** Server clock when the page data was read, for countdowns. */
  loadedAt: number;
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
      prizeAnchor: contestPrizeAnchor(kind, preset),
      roundNumber: round.roundNumber,
      startedAt: round.startedAt.toISOString(),
      endsAt: round.endsAt.toISOString(),
      entrants: ranked.length,
      leaders: ranked.slice(0, LEADERS_SHOWN),
      viewer: viewerEntry,
    });
  }

  return {
    loadedAt: Date.now(),
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
  const round = await getContestRoundsCollection(db).findOne(
    { kind: "referrals_iteration", status: "active" },
    { projection: { startedAt: 1, standings: 1 } }
  );
  if (!round) {
    return { running: false, startedAt: null, leaders: [], viewerCount: null, viewerRank: null };
  }
  // Standings are ranked, alt-filtered and refreshed every turn; a referrer is
  // shown by character name, never by account username.
  const standings = round.standings.filter((s) => s.score > 0);
  const mine = viewer ? standings.findIndex((s) => s.subjectId === viewer.userId) : -1;
  return {
    running: true,
    startedAt: round.startedAt.toISOString(),
    leaders: standings.slice(0, LEADERS_SHOWN).map((s, i) => ({
      rank: i + 1,
      name: s.characterName,
      count: s.score,
    })),
    viewerCount: viewer ? (mine >= 0 ? standings[mine].score : 0) : null,
    viewerRank: mine >= 0 ? mine + 1 : null,
  };
}

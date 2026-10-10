/**
 * Read model for the Contests page: live weekly rounds with their leaders and
 * the viewer's own standing, recent winners, and the referral leaderboard
 * (loadContestsPage).
 */
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import type { Character, Corporation, PoliticalParty } from "@/lib/db/types";
import type {
  ContestKind,
  ContestRecordKind,
  ContestStanding,
  ContestWinner,
} from "@/lib/db/types/contestRound";
import { getGameStatePreset } from "@/lib/db/collections/gameState";
import { getContestRoundsCollection } from "./collection";
import { CONTEST_KINDS, CORP_CONTEST_KINDS, contestPrizeAnchor } from "./rules";

const LEADERS_SHOWN = 10;
const PAST_ROUNDS_SHOWN = 12;

/**
 * Shown beside an entry: the corporation's or party's logo and the player's
 * portrait, each linked to its page.
 */
export interface EntryImages {
  logoKind?: "corporation" | "party" | null;
  logoUrl?: string | null;
  /** Party colour, the fallback when a party has no logo. */
  logoColor?: string | null;
  partyId?: string | null;
  avatarUrl?: string | null;
  subjectHref?: string | null;
  characterHref?: string | null;
}

type RankedEntry = ContestStanding & EntryImages & { rank: number };

export interface ContestCardData {
  kind: ContestKind;
  /** Cash prize for this round's winner, in ₳. */
  prizeAnchor: number;
  roundNumber: number;
  startedAt: string;
  endsAt: string;
  /** When the standings were last recomputed; null before the first refresh. */
  refreshedAt: string | null;
  entrants: number;
  leaders: RankedEntry[];
  /** Viewer's best entry this round, when they have one. */
  viewer: RankedEntry | null;
}

export interface PastRoundData {
  id: string;
  kind: ContestRecordKind;
  roundNumber: number;
  settledAt: string;
  winners: Array<ContestWinner & EntryImages>;
}

export interface ReferralBoardData {
  running: boolean;
  startedAt: string | null;
  leaders: Array<{
    rank: number;
    name: string;
    count: number;
    characterId?: string;
    avatarUrl?: string | null;
    characterHref?: string | null;
  }>;
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
      refreshedAt: round.refreshedAt ? round.refreshedAt.toISOString() : null,
      entrants: ranked.length,
      leaders: ranked.slice(0, LEADERS_SHOWN),
      viewer: viewerEntry,
    });
  }

  const isCorp = (kind: ContestRecordKind) =>
    (CORP_CONTEST_KINDS as readonly ContestRecordKind[]).includes(kind);
  const isParty = (kind: ContestRecordKind) => kind === "party_growth";
  const corpIds = new Set<string>();
  const partyIds = new Set<string>();
  const characterIds = new Set<string>();
  const collect = (kind: ContestRecordKind, e: { subjectId: string; characterId: string }) => {
    if (isCorp(kind)) corpIds.add(e.subjectId);
    if (isParty(kind)) partyIds.add(e.subjectId);
    characterIds.add(e.characterId);
  };
  for (const c of contests) {
    for (const s of c.leaders) collect(c.kind, s);
    if (c.viewer) collect(c.kind, c.viewer);
  }
  for (const r of past) for (const w of r.winners) collect(r.kind, w);
  for (const l of referrals.leaders) if (l.characterId) characterIds.add(l.characterId);
  const { corps, parties, characters } = await loadEntryImages(db, corpIds, partyIds, characterIds);
  const withImages = <E extends { subjectId: string; characterId: string }>(
    kind: ContestRecordKind,
    e: E
  ): E & EntryImages => {
    const subject = isCorp(kind)
      ? corps.get(e.subjectId)
      : isParty(kind)
        ? parties.get(e.subjectId)
        : undefined;
    return {
      ...e,
      logoKind: subject ? (isCorp(kind) ? "corporation" : "party") : null,
      logoUrl: subject?.logoUrl ?? null,
      logoColor: subject?.color ?? null,
      partyId: isParty(kind) ? (subject?.partyId ?? null) : null,
      subjectHref: subject?.href ?? null,
      avatarUrl: characters.get(e.characterId)?.avatarUrl ?? null,
      characterHref: characters.get(e.characterId)?.href ?? null,
    };
  };

  return {
    loadedAt: Date.now(),
    contests: contests.map((c) => ({
      ...c,
      leaders: c.leaders.map((s) => withImages(c.kind, s)),
      viewer: c.viewer ? withImages(c.kind, c.viewer) : null,
    })),
    past: past.map((r) => ({
      id: r._id,
      kind: r.kind,
      roundNumber: r.roundNumber,
      settledAt: (r.settledAt ?? new Date(0)).toISOString(),
      winners: r.winners.map((w) => withImages(r.kind, w)),
    })),
    referrals: {
      ...referrals,
      leaders: referrals.leaders.map((l) => ({
        ...l,
        avatarUrl: l.characterId ? (characters.get(l.characterId)?.avatarUrl ?? null) : null,
        characterHref: l.characterId ? (characters.get(l.characterId)?.href ?? null) : null,
      })),
    },
  };
}

function characterHref(c: Pick<Character, "_id" | "sequentialId"> | undefined): string | null {
  return c ? `/character/${c.sequentialId ?? c._id.toString()}` : null;
}

interface LinkedImage {
  href: string;
  logoUrl?: string | null;
  avatarUrl?: string | null;
  color?: string | null;
  partyId?: string | null;
}

/** One batched read each for corporation logos and character portraits, with their profile links. */
async function loadEntryImages(
  db: Db,
  corpIds: Set<string>,
  partyIds: Set<string>,
  characterIds: Set<string>
): Promise<{
  corps: Map<string, LinkedImage>;
  parties: Map<string, LinkedImage>;
  characters: Map<string, LinkedImage>;
}> {
  const toIds = (ids: Set<string>) =>
    [...ids].filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id));
  const [corpDocs, partyDocs, characterDocs] = await Promise.all([
    corpIds.size === 0
      ? []
      : db
          .collection<Corporation>("corporations")
          .find({ _id: { $in: toIds(corpIds) } }, { projection: { logoUrl: 1, sequentialId: 1 } })
          .toArray(),
    partyIds.size === 0
      ? []
      : db
          .collection<PoliticalParty>("politicalParties")
          .find(
            { _id: { $in: toIds(partyIds) } },
            { projection: { logoUrl: 1, sequentialId: 1, countryId: 1, color: 1 } }
          )
          .toArray(),
    characterIds.size === 0
      ? []
      : db
          .collection<Character>("characters")
          .find(
            { _id: { $in: toIds(characterIds) } },
            { projection: { avatarUrl: 1, sequentialId: 1 } }
          )
          .toArray(),
  ]);
  const corps = new Map<string, LinkedImage>();
  for (const c of corpDocs) {
    const id = c._id.toString();
    corps.set(id, { href: `/corporation/${c.sequentialId ?? id}`, logoUrl: c.logoUrl ?? null });
  }
  const parties = new Map<string, LinkedImage>();
  for (const p of partyDocs) {
    parties.set(p._id.toString(), {
      href: `/country/${p.countryId}/parties/${p.sequentialId}`,
      logoUrl: p.logoUrl ?? null,
      color: p.color ?? null,
      partyId: String(p.sequentialId),
    });
  }
  const characters = new Map<string, LinkedImage>();
  for (const c of characterDocs) {
    const id = c._id.toString();
    characters.set(id, { href: characterHref(c)!, avatarUrl: c.avatarUrl ?? null });
  }
  return { corps, parties, characters };
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
      characterId: s.characterId,
    })),
    viewerCount: viewer ? (mine >= 0 ? standings[mine].score : 0) : null,
    viewerRank: mine >= 0 ? mine + 1 : null,
  };
}

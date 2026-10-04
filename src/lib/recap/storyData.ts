import type { CareerEvent } from "@/lib/db/types/character";
import { officeRank } from "@/lib/character/deriveHighestOffice";
import { turnToGameMonth, calendarTurn, type CalendarClock } from "@/lib/utils/gameDate";
import type {
  RecapActivity,
  RecapBillSummary,
  RecapCareerMark,
  RecapCareerStep,
  RecapGameDate,
  RecapLegislation,
  RecapRace,
  RecapRaceCandidate,
  RecapRaces,
  RecapRival,
  RecapWealthSeries,
} from "./types";

/**
 * Pure builders for the v2 Wrapped story. Every function here takes plain rows
 * already read from Mongo and returns a frozen recap section, so each one is
 * unit-testable without a database. The loader (`loadStoryData.ts`) owns I/O.
 */

/** Most bins any series is cut into; keeps a recap doc small and a strip legible. */
export const MAX_BINS = 96;

// ── Clock ──────────────────────────────────────────────────────────────────────

export interface RecapClock extends CalendarClock {
  currentTurn: number;
  startingYear: number;
  /**
   * `[epochMs, turn]` pairs sorted by time: the first action seen on each turn.
   * Career events only carry wall-clock dates, and the game pauses for
   * maintenance, so a fixed ms-per-turn conversion drifts by a day of turns per
   * day paused. Interpolating against observed turns does not.
   */
  turnTimeline: Array<[number, number]>;
  /** Fallback anchor when the timeline is empty. */
  lastTurnProcessed: Date | null;
  msPerTurn: number;
}

export function dateOfTurn(rawTurn: number, clock: RecapClock): RecapGameDate {
  return turnToGameMonth(calendarTurn(rawTurn, clock), clock.startingYear);
}

/** Raw turn a wall-clock moment fell on. */
export function turnOfDate(date: Date | string | undefined, clock: RecapClock): number | null {
  if (!date) return null;
  const ms = new Date(date).getTime();
  if (!Number.isFinite(ms)) return null;
  const tl = clock.turnTimeline;
  if (tl.length > 0) {
    if (ms <= tl[0][0]) return tl[0][1];
    let lo = 0;
    let hi = tl.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (tl[mid][0] <= ms) lo = mid;
      else hi = mid - 1;
    }
    return tl[lo][1];
  }
  if (!clock.lastTurnProcessed) return null;
  const ago = Math.round((clock.lastTurnProcessed.getTime() - ms) / clock.msPerTurn);
  return Math.max(1, Math.min(clock.currentTurn, clock.currentTurn - ago));
}

// ── Activity ───────────────────────────────────────────────────────────────────

export function binLayout(startTurn: number, endTurn: number): { binTurns: number; n: number } {
  const span = Math.max(1, endTurn - startTurn + 1);
  const binTurns = Math.max(1, Math.ceil(span / MAX_BINS));
  return { binTurns, n: Math.ceil(span / binTurns) };
}

/** Bin a character's per-turn action counts across their life. */
export function buildActivity(
  perTurn: Map<number, number>,
  startTurn: number,
  clock: RecapClock
): RecapActivity | null {
  if (perTurn.size === 0) return null;
  const endTurn = clock.currentTurn;
  const start = Math.min(startTurn, ...perTurn.keys());
  const { binTurns, n } = binLayout(start, endTurn);
  const bins = new Array<number>(n).fill(0);
  for (const [turn, count] of perTurn) {
    const i = Math.min(n - 1, Math.max(0, Math.floor((turn - start) / binTurns)));
    bins[i] += count;
  }

  const turns = [...perTurn.keys()].sort((a, b) => a - b);
  let longest = 0;
  let run = 0;
  let prev = Number.NaN;
  for (const t of turns) {
    run = t === prev + 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = t;
  }

  let best = -1;
  for (let i = 0; i < n; i++) if (best < 0 || bins[i] > bins[best]) best = i;
  const busiest =
    best >= 0 && bins[best] > 0
      ? {
          from: dateOfTurn(start + best * binTurns, clock),
          to: dateOfTurn(Math.min(endTurn, start + (best + 1) * binTurns - 1), clock),
          actions: bins[best],
        }
      : null;

  return {
    startTurn: start,
    binTurns,
    bins,
    activeTurns: turns.length,
    longestStreak: longest,
    busiest,
  };
}

// ── Career ─────────────────────────────────────────────────────────────────────

const HELD = new Set(["elected", "appointed"]);

/**
 * "The climb": each first time the character reached a higher office tier, in
 * order, plus every win, loss, appointment and exit as a mark for the strip.
 */
export function buildCareer(
  history: CareerEvent[] | undefined,
  clock: RecapClock,
  electionTurns: Map<string, number>
): { climb: RecapCareerStep[]; marks: RecapCareerMark[] } {
  const events = [...(history ?? [])]
    .filter((e) => e.date)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const climb: RecapCareerStep[] = [];
  const marks: RecapCareerMark[] = [];
  let top = 0;
  for (const e of events) {
    const turn =
      (e.electionId ? electionTurns.get(String(e.electionId)) : undefined) ??
      turnOfDate(e.date, clock);
    if (turn == null) continue;
    if (e.office && HELD.has(e.type)) {
      const rank = officeRank(e.office.type);
      if (rank > top) {
        top = rank;
        climb.push({ label: e.officeLabel, rank, turn, date: dateOfTurn(turn, clock) });
      }
    }
    const kind: RecapCareerMark["kind"] | null =
      e.type === "elected"
        ? "won"
        : e.type === "lost_election"
          ? "lost"
          : e.type === "appointed"
            ? "appointed"
            : e.type === "resigned" || e.type === "removed"
              ? "left"
              : null;
    if (kind) marks.push({ turn, kind, label: e.officeLabel });
  }
  return { climb, marks: marks.slice(-60) };
}

// ── Races ──────────────────────────────────────────────────────────────────────

export interface SnapshotCandidateRow {
  id: string;
  name: string;
  partyName: string;
  partyColor: string;
  isNPP: boolean;
  totalVotes: number;
  voteSharePct: number;
  electoralVotes?: number;
  seatsProjected?: number;
}

/** One finished race the character stood in, joined from snapshot + election + career. */
export interface RaceInput {
  electionId: string;
  /** This character's candidate row id in the snapshot. */
  candidateId: string;
  label: string;
  year: number | null;
  turn: number | null;
  region: string | null;
  seats: number;
  isPresidential: boolean;
  /** From careerHistory when it recorded this election; null = derive from votes. */
  careerWon: boolean | null;
  candidates: SnapshotCandidateRow[];
}

const FIELD_SIZE = 4;

function raceOutcome(r: RaceInput): {
  won: boolean;
  marginPct: number;
  marginVotes: number;
} | null {
  const you = r.candidates.find((c) => c.id === r.candidateId);
  if (!you) return null;
  const others = r.candidates.filter((c) => c.id !== r.candidateId);
  const score = (c: SnapshotCandidateRow) =>
    r.isPresidential ? (c.electoralVotes ?? 0) : c.totalVotes;
  const best = others.reduce<SnapshotCandidateRow | null>(
    (acc, c) => (!acc || score(c) > score(acc) ? c : acc),
    null
  );
  const derivedWon =
    r.seats > 1 ? (you.seatsProjected ?? 0) > 0 : !best || score(you) > score(best);
  const won = r.careerWon ?? derivedWon;
  if (!best) return { won, marginPct: you.voteSharePct, marginVotes: you.totalVotes };
  return {
    won,
    marginPct: you.voteSharePct - best.voteSharePct,
    marginVotes: you.totalVotes - best.totalVotes,
  };
}

function toRace(r: RaceInput): RecapRace | null {
  const o = raceOutcome(r);
  if (!o) return null;
  const sorted = [...r.candidates].sort((a, b) => b.totalVotes - a.totalVotes);
  const top = sorted.slice(0, FIELD_SIZE);
  if (!top.some((c) => c.id === r.candidateId)) {
    const you = sorted.find((c) => c.id === r.candidateId);
    if (you) top[top.length - 1] = you;
  }
  const field: RecapRaceCandidate[] = top.map((c) => ({
    name: c.name,
    partyName: c.partyName,
    color: c.partyColor,
    votes: c.totalVotes,
    share: c.voteSharePct,
    isYou: c.id === r.candidateId,
  }));
  return {
    label: r.label,
    year: r.year,
    turn: r.turn,
    won: o.won,
    seats: r.seats,
    marginPct: o.marginPct,
    marginVotes: o.marginVotes,
    field,
  };
}

/**
 * Best win, closest race, first win, rival and win map for one character.
 * `opponentIdentity` maps a snapshot candidate id to a stable player identity
 * (characterId) so the same rival is recognized across races; NPP and unknown
 * candidates are absent and never become a rival.
 */
export function buildRaces(
  inputs: RaceInput[],
  opponentIdentity: Map<string, string>
): RecapRaces | null {
  if (inputs.length === 0) return null;
  const ordered = [...inputs].sort((a, b) => (a.turn ?? 0) - (b.turn ?? 0));
  let totalVotes = 0;
  let bestWin: RecapRace | null = null;
  let closest: RecapRace | null = null;
  let firstWin: RecapRace | null = null;
  const winsByRegion: Record<string, number> = {};
  const rivals = new Map<
    string,
    { name: string; partyName: string; color: string; history: RecapRival["history"] }
  >();

  for (const input of ordered) {
    const race = toRace(input);
    if (!race) continue;
    const you = input.candidates.find((c) => c.id === input.candidateId);
    totalVotes += you?.totalVotes ?? 0;
    if (race.won) {
      if (!firstWin) firstWin = race;
      if (input.region) winsByRegion[input.region] = (winsByRegion[input.region] ?? 0) + 1;
    }
    if (race.seats === 1 && race.field.length > 1) {
      if (race.won && (!bestWin || race.marginPct > bestWin.marginPct)) bestWin = race;
      if (!closest || Math.abs(race.marginVotes) < Math.abs(closest.marginVotes)) closest = race;
    }
    if (!you) continue;
    for (const c of input.candidates) {
      if (c.id === input.candidateId || c.isNPP) continue;
      // In a multi-seat list race your own party's list is not your opponent.
      if (input.seats > 1 && c.partyName === you.partyName) continue;
      const identity = opponentIdentity.get(c.id);
      if (!identity) continue;
      const entry = rivals.get(identity) ?? {
        name: c.name,
        partyName: c.partyName,
        color: c.partyColor,
        history: [],
      };
      entry.name = c.name;
      entry.partyName = c.partyName;
      entry.color = c.partyColor;
      entry.history.push({
        label: input.label,
        year: input.year,
        ahead: you.totalVotes > c.totalVotes,
      });
      rivals.set(identity, entry);
    }
  }

  let rival: RecapRival | null = null;
  for (const r of rivals.values()) {
    if (r.history.length < 2) continue;
    if (!rival || r.history.length > rival.meetings) {
      const ahead = r.history.filter((h) => h.ahead).length;
      rival = {
        name: r.name,
        partyName: r.partyName,
        color: r.color,
        meetings: r.history.length,
        ahead,
        behind: r.history.length - ahead,
        history: [...r.history].reverse().slice(0, 5),
      };
    }
  }

  if (closest && bestWin && closest.label === bestWin.label && closest.year === bestWin.year) {
    // One single-seat race is both; show it once, as the best win.
    closest = null;
  }

  return {
    contested: ordered.length,
    totalVotes,
    bestWin,
    closest,
    firstWin,
    rival,
    winsByRegion,
  };
}

// ── Legislation ────────────────────────────────────────────────────────────────

type Vote = "for" | "against" | "abstain";

export interface BillVoteRow {
  title: string;
  passed: boolean;
  failedOnFloor: boolean;
  year: number | null;
  sponsorId: string | null;
  /** One entry per chamber that voted: the frozen snapshot when present, else raw votes. */
  chambers: Array<{
    votes: Record<string, Vote>;
    weights: Record<string, number>;
    totals: { for: number; against: number; abstain: number };
  }>;
}

const MIN_LOYALTY_VOTES = 5;

/**
 * Roll-call record for one character. `partyOf` resolves any voter key
 * (characterId or `npp_<id>`) to a `country:party` key so party majorities
 * include NPP members.
 */
export function buildLegislation(
  characterId: string,
  bills: BillVoteRow[],
  partyOf: (voterKey: string) => string | null
): RecapLegislation | null {
  const myParty = partyOf(characterId);
  let votesCast = 0;
  let votedFor = 0;
  let votedAgainst = 0;
  let abstained = 0;
  let loyal = 0;
  let comparable = 0;
  const decisive: Array<RecapBillSummary & { margin: number }> = [];
  let signature: RecapBillSummary | null = null;
  let signatureWeight = -1;

  for (const bill of bills) {
    let yourVote: Vote | null = null;
    for (const chamber of bill.chambers) {
      const mine = chamber.votes[characterId];
      if (!mine) continue;
      yourVote = mine;
      votesCast++;
      if (mine === "for") votedFor++;
      else if (mine === "against") votedAgainst++;
      else abstained++;

      if (myParty && mine !== "abstain") {
        let partyFor = 0;
        let partyAgainst = 0;
        for (const [key, v] of Object.entries(chamber.votes)) {
          if (key === characterId || partyOf(key) !== myParty) continue;
          const w = chamber.weights[key] ?? 1;
          if (v === "for") partyFor += w;
          else if (v === "against") partyAgainst += w;
        }
        if (partyFor !== partyAgainst) {
          comparable++;
          if ((partyFor > partyAgainst ? "for" : "against") === mine) loyal++;
        }
      }

      const w = chamber.weights[characterId] ?? 1;
      const margin = chamber.totals.for - chamber.totals.against;
      const decided =
        (bill.passed && mine === "for" && margin > 0 && margin <= w) ||
        (bill.failedOnFloor && mine === "against" && margin <= 0 && -margin < w);
      if (decided) {
        decisive.push({
          title: bill.title,
          passed: bill.passed,
          year: bill.year,
          for: chamber.totals.for,
          against: chamber.totals.against,
          abstain: chamber.totals.abstain,
          yourVote: mine,
          margin: Math.abs(margin),
        });
      }
    }

    if (bill.sponsorId === characterId) {
      const chamber = bill.chambers[0];
      const weight = (bill.passed ? 1e9 : 0) + (chamber ? chamber.totals.for : 0);
      if (weight > signatureWeight) {
        signatureWeight = weight;
        signature = {
          title: bill.title,
          passed: bill.passed,
          year: bill.year,
          for: chamber?.totals.for ?? 0,
          against: chamber?.totals.against ?? 0,
          abstain: chamber?.totals.abstain ?? 0,
          yourVote,
        };
      }
    }
  }

  if (votesCast === 0 && !signature) return null;
  decisive.sort((a, b) => a.margin - b.margin);
  return {
    votesCast,
    votedFor,
    votedAgainst,
    abstained,
    partyLoyaltyPct: comparable >= MIN_LOYALTY_VOTES ? (loyal / comparable) * 100 : null,
    signature,
    decisive: decisive.slice(0, 3).map(({ margin: _margin, ...rest }) => rest),
  };
}

// ── Wealth ─────────────────────────────────────────────────────────────────────

/** Bin per-turn net portfolio values (already in home currency) into a series. */
export function buildWealth(
  perTurn: Array<[number, number]>,
  clock: RecapClock
): RecapWealthSeries | null {
  if (perTurn.length < 2) return null;
  const sorted = [...perTurn].sort((a, b) => a[0] - b[0]);
  const start = sorted[0][0];
  const end = sorted[sorted.length - 1][0];
  const { binTurns, n } = binLayout(start, end);
  const sums = new Array<number>(n).fill(0);
  const counts = new Array<number>(n).fill(0);
  let peak: { value: number; turn: number } | null = null;
  for (const [turn, value] of sorted) {
    const i = Math.min(n - 1, Math.floor((turn - start) / binTurns));
    sums[i] += value;
    counts[i]++;
    if (!peak || value > peak.value) peak = { value, turn };
  }
  const points: number[] = [];
  let last = sorted[0][1];
  for (let i = 0; i < n; i++) {
    if (counts[i] > 0) last = sums[i] / counts[i];
    points.push(Math.round(last));
  }
  if (points.every((p) => p === points[0])) return null;
  return {
    startTurn: start,
    binTurns,
    points,
    peak: peak ? { value: Math.round(peak.value), date: dateOfTurn(peak.turn, clock) } : null,
  };
}

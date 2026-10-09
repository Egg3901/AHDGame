/**
 * Weekly contests, run after each turn commits: opens a round per kind with a
 * baseline snapshot, refreshes standings each turn, and when a round's week is
 * up pays the leader a cash prize and opens the next round (runContestsAfterTurn).
 */
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import * as Sentry from "@sentry/nextjs";
import type { Character, Corporation, GovernmentApproval, User } from "@/lib/db/types";
import type { CorporationHistory } from "@/lib/db/types/corporationHistory";
import type {
  ContestBaseline,
  ContestKind,
  ContestRound,
  ContestStanding,
} from "@/lib/db/types/contestRound";
import type { CountryId } from "@/lib/constants/countries";
import { getCountryDisplayName } from "@/lib/constants/countries";
import { getGameStatePreset } from "@/lib/db/collections/gameState";
import { getHeadOfGovernmentCharacterIds } from "@/lib/api/headOfGovernment";
import {
  CONTEST_KINDS,
  CONTEST_ROUND_MS,
  approvalEntryEligible,
  contestRoundId,
  corpGrowthScore,
  corpMinOpeningAnchor,
  gainScore,
  pickWinner,
  rankStandings,
  roundBelongsToEarlierWorld,
  roundIsDue,
  splitCorpTiers,
  type CorpOpening,
} from "./rules";
import { payContestPrize } from "./prize";
import { getContestRoundsCollection } from "./collection";

type PlayerCharacter = Pick<
  Character,
  "_id" | "userId" | "name" | "countryId" | "nationalInfluence" | "sequentialId"
>;

interface ContestWorld {
  turn: number;
  now: Date;
  preset: string | undefined;
  players: Map<string, PlayerCharacter>;
}

const contestRounds = getContestRoundsCollection;

/** Live player characters whose accounts are not banned. */
async function loadPlayers(db: Db): Promise<Map<string, PlayerCharacter>> {
  const characters = await db
    .collection<Character>("characters")
    .find(
      {},
      {
        projection: {
          _id: 1,
          userId: 1,
          name: 1,
          countryId: 1,
          nationalInfluence: 1,
          sequentialId: 1,
        },
      }
    )
    .toArray();
  const userIds = characters.map((c) => c.userId).filter(Boolean);
  const banned = await db
    .collection<User>("users")
    .find({ _id: { $in: userIds }, isBanned: true }, { projection: { _id: 1 } })
    .toArray();
  const bannedIds = new Set(banned.map((u) => u._id.toString()));
  const players = new Map<string, PlayerCharacter>();
  for (const c of characters) {
    if (!c.userId || bannedIds.has(c.userId.toString())) continue;
    players.set(c._id.toString(), c as PlayerCharacter);
  }
  return players;
}

interface CorpRow {
  corporationId: string;
  name: string;
  ceoCharacterId: string;
  capLocal: number;
  capAnchor: number;
}

/** Player-run private corporations with their latest market cap snapshot. */
async function loadCorpRows(db: Db, world: ContestWorld): Promise<Map<string, CorpRow>> {
  const corps = await db
    .collection<Corporation>("corporations")
    .find(
      { ceoType: "character", ownershipState: { $ne: "stateOwned" } },
      { projection: { _id: 1, name: 1, ceoId: 1 } }
    )
    .toArray();
  const playerCorps = corps.filter((c) => c.ceoId && world.players.has(c.ceoId.toString()));
  if (playerCorps.length === 0) return new Map();

  const history = await db
    .collection<CorporationHistory>("corporationHistory")
    .find(
      {
        corporationId: { $in: playerCorps.map((c) => c._id) },
        turn: { $gte: world.turn - 5, $lte: world.turn },
      },
      { projection: { corporationId: 1, turn: 1, marketCap: 1, fxRateAtWrite: 1 } }
    )
    .sort({ turn: -1 })
    .toArray();
  const latest = new Map<string, CorporationHistory>();
  for (const row of history) {
    const id = row.corporationId.toString();
    if (!latest.has(id)) latest.set(id, row);
  }

  const rows = new Map<string, CorpRow>();
  for (const corp of playerCorps) {
    const id = corp._id.toString();
    const snap = latest.get(id);
    if (!snap || !Number.isFinite(snap.marketCap)) continue;
    const rate = snap.fxRateAtWrite && snap.fxRateAtWrite > 0 ? snap.fxRateAtWrite : 1;
    rows.set(id, {
      corporationId: id,
      name: corp.name,
      ceoCharacterId: corp.ceoId.toString(),
      capLocal: snap.marketCap,
      capAnchor: snap.marketCap / rate,
    });
  }
  return rows;
}

/**
 * Net capital moved into each corporation from outside it since `since`.
 * Internal moves (a corporation recapitalising its own bank) are ignored.
 */
async function loadInjections(
  db: Db,
  corporationIds: string[],
  since: Date,
  until: Date
): Promise<Map<string, number>> {
  const totals = new Map<string, number>();
  if (corporationIds.length === 0) return totals;
  const rows = await db
    .collection("financialTxLog")
    .find(
      {
        type: "corp_capital_injection",
        subjectType: "corporation",
        subjectId: { $in: corporationIds.map((id) => new ObjectId(id)) },
        createdAt: { $gt: since, $lte: until },
      },
      { projection: { subjectId: 1, counterpartyId: 1, amount: 1 } }
    )
    .toArray();
  for (const row of rows) {
    const id = String(row.subjectId);
    if (row.counterpartyId && String(row.counterpartyId) === id) continue;
    const amount = typeof row.amount === "number" ? row.amount : 0;
    totals.set(id, (totals.get(id) ?? 0) + amount);
  }
  return totals;
}

async function loadApprovals(db: Db): Promise<Map<string, number>> {
  const docs = await db
    .collection<GovernmentApproval>("governmentApprovals")
    .find({}, { projection: { _id: 1, approvalRating: 1 } })
    .toArray();
  return new Map(docs.map((d) => [String(d._id), d.approvalRating]));
}

async function loadPlayerHeads(
  db: Db,
  world: ContestWorld,
  countryIds: string[]
): Promise<Map<string, string | null>> {
  const heads = await getHeadOfGovernmentCharacterIds(db, countryIds as CountryId[]);
  const out = new Map<string, string | null>();
  for (const [countryId, head] of heads) {
    const id = head?.toString() ?? null;
    out.set(countryId, id && world.players.has(id) ? id : null);
  }
  return out;
}

// ── Opening a round ─────────────────────────────────────────────────────────

async function openingBaselines(
  db: Db,
  world: ContestWorld,
  kinds: ContestKind[]
): Promise<Map<ContestKind, { baselines: ContestBaseline[]; tierBoundaryAnchor?: number }>> {
  const out = new Map<ContestKind, { baselines: ContestBaseline[]; tierBoundaryAnchor?: number }>();

  if (kinds.includes("corp_growth_small") || kinds.includes("corp_growth_large")) {
    const corps = await loadCorpRows(db, world);
    const openings: CorpOpening[] = [...corps.values()].map((c) => ({
      corporationId: c.corporationId,
      characterId: c.ceoCharacterId,
      capLocal: c.capLocal,
      capAnchor: c.capAnchor,
    }));
    const split = splitCorpTiers(openings, corpMinOpeningAnchor(world.preset));
    const toBaseline = (o: CorpOpening): ContestBaseline => ({
      subjectId: o.corporationId,
      characterId: o.characterId,
      value: o.capLocal,
      injected: 0,
    });
    out.set("corp_growth_small", {
      baselines: split.small.map(toBaseline),
      tierBoundaryAnchor: split.boundaryAnchor,
    });
    out.set("corp_growth_large", {
      baselines: split.large.map(toBaseline),
      tierBoundaryAnchor: split.boundaryAnchor,
    });
  }

  if (kinds.includes("influence_gain")) {
    out.set("influence_gain", {
      baselines: [...world.players.values()].map((c) => ({
        subjectId: c._id.toString(),
        characterId: c._id.toString(),
        value: c.nationalInfluence ?? 0,
      })),
    });
  }

  if (kinds.includes("approval_gain")) {
    const approvals = await loadApprovals(db);
    const heads = await loadPlayerHeads(db, world, [...approvals.keys()]);
    const baselines: ContestBaseline[] = [];
    for (const [countryId, rating] of approvals) {
      const head = heads.get(countryId);
      if (!head || !Number.isFinite(rating)) continue;
      baselines.push({ subjectId: countryId, characterId: head, value: rating });
    }
    out.set("approval_gain", { baselines });
  }

  return out;
}

async function openRounds(db: Db, world: ContestWorld, kinds: ContestKind[]): Promise<number> {
  if (kinds.length === 0) return 0;
  const last = await contestRounds(db)
    .find({ kind: { $in: kinds } }, { projection: { kind: 1, roundNumber: 1 } })
    .sort({ roundNumber: -1 })
    .toArray();
  const lastNumber = new Map<string, number>();
  for (const r of last) if (!lastNumber.has(r.kind)) lastNumber.set(r.kind, r.roundNumber);

  const baselines = await openingBaselines(db, world, kinds);
  let opened = 0;
  for (const kind of kinds) {
    const roundNumber = (lastNumber.get(kind) ?? 0) + 1;
    const opening = baselines.get(kind) ?? { baselines: [] };
    try {
      await contestRounds(db).insertOne({
        _id: contestRoundId(kind, roundNumber),
        kind,
        roundNumber,
        status: "active",
        startedAt: world.now,
        endsAt: new Date(world.now.getTime() + CONTEST_ROUND_MS),
        startTurn: world.turn,
        ...(opening.tierBoundaryAnchor !== undefined
          ? { tierBoundaryAnchor: opening.tierBoundaryAnchor }
          : {}),
        baselines: opening.baselines,
        standings: [],
        winners: [],
      });
      opened++;
    } catch (err) {
      // Duplicate id: another process opened this round first.
      if ((err as { code?: number }).code !== 11000) throw err;
    }
  }
  return opened;
}

// ── Standings ───────────────────────────────────────────────────────────────

async function computeStandings(
  db: Db,
  world: ContestWorld,
  round: ContestRound
): Promise<{ standings: ContestStanding[]; baselines: ContestBaseline[] }> {
  const kind = round.kind as ContestKind;
  const standings: ContestStanding[] = [];
  const baselines = round.baselines;

  if (kind === "corp_growth_small" || kind === "corp_growth_large") {
    const corps = await loadCorpRows(db, world);
    // Injections accumulate across refreshes so the round never depends on
    // financialTxLog rows outliving their retention window.
    const since = round.refreshedAt ?? round.startedAt;
    const fresh = await loadInjections(
      db,
      baselines.map((b) => b.subjectId),
      since,
      world.now
    );
    const updated = baselines.map((b) => ({
      ...b,
      injected: (b.injected ?? 0) + (fresh.get(b.subjectId) ?? 0),
    }));
    for (const b of updated) {
      const corp = corps.get(b.subjectId);
      if (!corp) continue;
      const ceo = world.players.get(corp.ceoCharacterId);
      if (!ceo) continue;
      const score = corpGrowthScore(b.value, corp.capLocal, b.injected ?? 0);
      if (score === null) continue;
      standings.push({
        subjectId: b.subjectId,
        subjectName: corp.name,
        characterId: corp.ceoCharacterId,
        characterName: ceo.name,
        baseline: b.value,
        current: corp.capLocal,
        score,
      });
    }
    return { standings: rankStandings(standings), baselines: updated };
  }

  if (kind === "influence_gain") {
    for (const b of baselines) {
      const c = world.players.get(b.characterId);
      if (!c) continue;
      const current = c.nationalInfluence ?? 0;
      const score = gainScore(b.value, current);
      if (score === null) continue;
      standings.push({
        subjectId: b.subjectId,
        subjectName: c.name,
        characterId: b.characterId,
        characterName: c.name,
        baseline: b.value,
        current,
        score,
      });
    }
    return { standings: rankStandings(standings), baselines };
  }

  // approval_gain
  const approvals = await loadApprovals(db);
  const heads = await loadPlayerHeads(
    db,
    world,
    baselines.map((b) => b.subjectId)
  );
  for (const b of baselines) {
    if (!approvalEntryEligible(b.characterId, heads.get(b.subjectId) ?? null)) continue;
    const c = world.players.get(b.characterId);
    const current = approvals.get(b.subjectId);
    if (!c || current === undefined) continue;
    const score = gainScore(b.value, current);
    if (score === null) continue;
    standings.push({
      subjectId: b.subjectId,
      subjectName: getCountryDisplayName(b.subjectId as CountryId, world.preset),
      characterId: b.characterId,
      characterName: c.name,
      baseline: b.value,
      current,
      score,
    });
  }
  return { standings: rankStandings(standings), baselines };
}

// ── Settlement ──────────────────────────────────────────────────────────────

async function settleRound(db: Db, world: ContestWorld, round: ContestRound): Promise<boolean> {
  const { standings, baselines } = await computeStandings(db, world, round);
  const leader = pickWinner(standings);
  const winner = leader
    ? {
        characterId: leader.characterId,
        characterName: leader.characterName,
        subjectId: leader.subjectId,
        subjectName: leader.subjectName,
        score: leader.score,
      }
    : null;

  // The status flip is the claim: only the process that moves the round out
  // of "active" pays, so a prize can never be paid twice.
  const claim = await contestRounds(db).updateOne(
    { _id: round._id, status: "active" },
    {
      $set: {
        status: "settled",
        settledAt: world.now,
        settledTurn: world.turn,
        standings,
        baselines,
        standingsTurn: world.turn,
        refreshedAt: world.now,
        winners: winner ? [winner] : [],
      },
    }
  );
  if (claim.modifiedCount !== 1 || !winner) return claim.modifiedCount === 1;

  const character = world.players.get(winner.characterId);
  if (!character) return true;
  try {
    const paid = await payContestPrize(db, {
      character,
      round: { _id: round._id, kind: round.kind as ContestKind, roundNumber: round.roundNumber },
      subjectName: winner.subjectName,
      turn: world.turn,
      preset: world.preset,
      now: world.now,
    });
    await contestRounds(db).updateOne(
      { _id: round._id },
      {
        $set: {
          "winners.0.prizeAnchor": paid.anchorAmount,
          "winners.0.prizeLocal": paid.localAmount,
          "winners.0.currencyCode": paid.currencyCode,
          ...(paid.credited ? { "winners.0.paidAt": world.now } : {}),
        },
      }
    );
  } catch (err) {
    Sentry.captureException(err, { tags: { area: "contests", round: round._id } });
    console.error(`[contests] prize payment failed for ${round._id}`, err);
  }
  return true;
}

// ── Entry point ─────────────────────────────────────────────────────────────

export interface ContestRunSummary {
  settled: number;
  voided: number;
  refreshed: number;
  opened: number;
}

declare global {
  var _ahdContestsRunning: boolean | undefined;
}

/**
 * Settle due rounds, refresh live standings, and open a round for every kind
 * without one. Safe to call concurrently: round ids are deterministic and
 * settlement claims each round with a conditional status flip.
 */
export async function runContests(
  db: Db,
  turn: number,
  now: Date = new Date()
): Promise<ContestRunSummary> {
  const summary: ContestRunSummary = { settled: 0, voided: 0, refreshed: 0, opened: 0 };
  const world: ContestWorld = {
    turn,
    now,
    preset: await getGameStatePreset(db),
    players: await loadPlayers(db),
  };

  const active = await contestRounds(db)
    .find({ status: "active", kind: { $in: [...CONTEST_KINDS] } })
    .toArray();

  const stillActive = new Set<string>();
  for (const round of active) {
    if (roundBelongsToEarlierWorld(round.startTurn, turn)) {
      const res = await contestRounds(db).updateOne(
        { _id: round._id, status: "active" },
        { $set: { status: "void", settledAt: now, settledTurn: turn } }
      );
      summary.voided += res.modifiedCount;
      continue;
    }
    if (roundIsDue(round.endsAt.getTime(), now.getTime())) {
      if (await settleRound(db, world, round)) summary.settled++;
      continue;
    }
    const { standings, baselines } = await computeStandings(db, world, round);
    await contestRounds(db).updateOne(
      { _id: round._id, status: "active" },
      { $set: { standings, baselines, standingsTurn: turn, refreshedAt: now } }
    );
    stillActive.add(round.kind);
    summary.refreshed++;
  }

  const missing = CONTEST_KINDS.filter((k) => !stillActive.has(k));
  summary.opened = await openRounds(db, world, missing);
  return summary;
}

/** Post-turn hook. Never throws and never overlaps itself within a process. */
export async function runContestsAfterTurn(db: Db, turn: number): Promise<void> {
  if (globalThis._ahdContestsRunning) return;
  globalThis._ahdContestsRunning = true;
  try {
    const summary = await runContests(db, turn);
    if (summary.settled || summary.opened || summary.voided) {
      console.log(
        `[contests] turn ${turn}: settled ${summary.settled}, opened ${summary.opened}, voided ${summary.voided}`
      );
    }
  } catch (err) {
    Sentry.captureException(err, { tags: { area: "contests" } });
    console.error("[contests] post-turn run failed", err);
  } finally {
    globalThis._ahdContestsRunning = false;
  }
}

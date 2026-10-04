import type { Db, Document } from "mongodb";
import { ObjectId } from "mongodb";
import type { Character } from "@/lib/db/types";
import type { GameState } from "@/lib/db/types/gameState";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { MS_PER_TURN, STARTING_YEAR } from "@/lib/constants/turnTime";
import { fetchExchangeRateMap, getRateDoc, rateFromDoc } from "@/lib/world/forex";
import {
  buildActivity,
  buildCareer,
  buildLegislation,
  buildRaces,
  buildWealth,
  dateOfTurn,
  type BillVoteRow,
  type RaceInput,
  type RecapClock,
  type SnapshotCandidateRow,
} from "./storyData";
import type { CharacterRecap, RecapCorporation, RecapRaces, RecapWorld } from "./types";

/**
 * I/O for the v2 Wrapped sections. Reads the runtime collections the reset is
 * about to wipe (actionLogs, elections, snapshots, bills, portfolioHistory) and
 * hands plain rows to the pure builders in `storyData.ts`.
 *
 * Every section is independent and best-effort: a failed read logs and leaves
 * that section absent, the rest of the recap still builds, and nothing here can
 * throw out to `resetGameWorld`.
 */

const PASSED = new Set(["signed", "enrolled", "veto_override", "override_shugiin"]);
const FINISHED_ELECTION = ["completed", "resolved"];

export type StorySections = Pick<
  CharacterRecap,
  | "arrived"
  | "departed"
  | "activity"
  | "climb"
  | "marks"
  | "races"
  | "legislation"
  | "wealth"
  | "corporation"
>;

export interface StoryDataResult {
  perCharacter: Map<string, StorySections>;
  world: RecapWorld | null;
}

type Warn = (section: string, err: unknown) => void;

async function section<T>(
  name: string,
  warn: Warn,
  fallback: T,
  run: () => Promise<T>
): Promise<T> {
  try {
    return await run();
  } catch (err) {
    warn(name, err);
    return fallback;
  }
}

function officeLabelFor(countryId: string, electionType: string, state: string | null): string {
  const config = Object.hasOwn(COUNTRY_CONFIGS, countryId)
    ? COUNTRY_CONFIGS[countryId as CountryId]
    : undefined;
  const label = config?.officeTypes.find((o) => o.key === electionType)?.label ?? electionType;
  return state ? `${label} (${state})` : label;
}

interface ElectionRow {
  _id: ObjectId;
  endTurn?: number;
  state?: string;
  electionType: string;
  countryId: string;
  electionYear?: number | null;
  totalSeats?: number;
}

interface SnapshotRow {
  electionId: ObjectId;
  electionType: string;
  countryId: string;
  electionYear: number | null;
  totalSeats: number;
  totalEv?: number;
  candidates: SnapshotCandidateRow[];
}

interface BillRow {
  title?: string;
  status: string;
  sponsorId?: ObjectId | null;
  votes?: Record<string, "for" | "against" | "abstain">;
  otherChamberVotes?: Record<string, "for" | "against" | "abstain">;
  votesFor?: number;
  votesAgainst?: number;
  votesAbstain?: number;
  otherChamberVotesFor?: number;
  otherChamberVotesAgainst?: number;
  otherChamberVotesAbstain?: number;
  voteSnapshot?: {
    votes: Record<string, "for" | "against" | "abstain">;
    weights: Record<string, number>;
    totals: { for: number; against: number; abstain: number };
    resolvedAtTurn?: number;
  };
  otherChamberVoteSnapshot?: BillRow["voteSnapshot"];
  votingEndsOnTurn?: number;
  proposedTurn?: number;
}

function billChambers(b: BillRow): BillVoteRow["chambers"] {
  const out: BillVoteRow["chambers"] = [];
  const origin = b.voteSnapshot ?? {
    votes: b.votes ?? {},
    weights: {},
    totals: { for: b.votesFor ?? 0, against: b.votesAgainst ?? 0, abstain: b.votesAbstain ?? 0 },
  };
  if (Object.keys(origin.votes).length > 0) out.push(origin);
  const other = b.otherChamberVoteSnapshot ?? {
    votes: b.otherChamberVotes ?? {},
    weights: {},
    totals: {
      for: b.otherChamberVotesFor ?? 0,
      against: b.otherChamberVotesAgainst ?? 0,
      abstain: b.otherChamberVotesAbstain ?? 0,
    },
  };
  if (Object.keys(other.votes).length > 0) out.push(other);
  return out;
}

export async function loadStoryData(
  db: Db,
  targets: Character[],
  field: Character[],
  ctx: { currentTurn: number },
  opts: { includeWorld: boolean; warn?: Warn }
): Promise<StoryDataResult> {
  const warn: Warn = opts.warn ?? (() => {});
  const perCharacter = new Map<string, StorySections>();
  if (targets.length === 0) return { perCharacter, world: null };
  const ids = targets.map((c) => c._id);
  const idSet = new Set(ids.map(String));
  const set = (id: string, patch: Partial<StorySections>) =>
    perCharacter.set(id, { ...(perCharacter.get(id) ?? {}), ...patch });

  // ── Clock ────────────────────────────────────────────────────────────────
  const gs = await section("clock", warn, null, () =>
    db.collection<GameState>("gameState").findOne(
      { _id: "current" },
      {
        projection: {
          startingYear: 1,
          preIterationTurns: 1,
          preIteration: 1,
          lastTurnProcessed: 1,
        },
      }
    )
  );
  const turnTimeline = await section("timeline", warn, [] as Array<[number, number]>, async () => {
    const rows = await db
      .collection("actionLogs")
      .aggregate<{ _id: number; t: Date }>([
        { $match: { turn: { $type: "number" } } },
        { $group: { _id: "$turn", t: { $min: "$createdAt" } } },
      ])
      .toArray();
    return rows
      .filter((r) => r.t instanceof Date)
      .map((r) => [r.t.getTime(), r._id] as [number, number])
      .sort((a, b) => a[0] - b[0]);
  });
  const clock: RecapClock = {
    currentTurn: ctx.currentTurn,
    startingYear: gs?.startingYear ?? STARTING_YEAR,
    preIterationTurns: gs?.preIterationTurns,
    preIterationActive: gs?.preIteration?.active === true,
    turnTimeline,
    lastTurnProcessed: gs?.lastTurnProcessed ? new Date(gs.lastTurnProcessed) : null,
    msPerTurn: MS_PER_TURN,
  };
  for (const c of targets) {
    set(String(c._id), {
      arrived: dateOfTurn(c.createdTurn ?? 1, clock),
      departed: dateOfTurn(ctx.currentTurn, clock),
    });
  }

  // ── Activity ─────────────────────────────────────────────────────────────
  await section("activity", warn, undefined, async () => {
    const rows = await db
      .collection("actionLogs")
      .aggregate<{ _id: { c: ObjectId; t: number }; n: number }>([
        { $match: { characterId: { $in: ids } } },
        { $group: { _id: { c: "$characterId", t: "$turn" }, n: { $sum: 1 } } },
      ])
      .toArray();
    const byChar = new Map<string, Map<number, number>>();
    for (const r of rows) {
      if (typeof r._id.t !== "number") continue;
      const id = String(r._id.c);
      const m = byChar.get(id) ?? new Map<number, number>();
      m.set(r._id.t, (m.get(r._id.t) ?? 0) + r.n);
      byChar.set(id, m);
    }
    for (const c of targets) {
      const m = byChar.get(String(c._id));
      if (m) set(String(c._id), { activity: buildActivity(m, c.createdTurn ?? 1, clock) });
    }
  });

  // ── Elections: candidacies, snapshots, career ────────────────────────────
  const careerElectionIds = new Set<string>();
  for (const c of targets)
    for (const e of c.careerHistory ?? [])
      if (e.electionId) careerElectionIds.add(String(e.electionId));

  const raceData = await section("races", warn, null, async () => {
    const candidacies = await db
      .collection("electionCandidates")
      .find(
        { characterId: { $in: ids } },
        { projection: { _id: 1, electionId: 1, characterId: 1 } }
      )
      .toArray();
    const electionIds = new Map<string, ObjectId>();
    for (const c of candidacies)
      if (c.electionId) electionIds.set(String(c.electionId), c.electionId);
    for (const id of careerElectionIds)
      if (ObjectId.isValid(id)) electionIds.set(id, new ObjectId(id));
    const oids = [...electionIds.values()];
    const [elections, snapshots] = await Promise.all([
      db
        .collection<ElectionRow>("elections")
        .find(
          { _id: { $in: oids } },
          {
            projection: {
              endTurn: 1,
              state: 1,
              electionType: 1,
              countryId: 1,
              electionYear: 1,
              totalSeats: 1,
            },
          }
        )
        .toArray(),
      db
        .collection<SnapshotRow>("electionResultSnapshots")
        .find(
          { electionId: { $in: oids } },
          {
            projection: {
              electionId: 1,
              electionType: 1,
              countryId: 1,
              electionYear: 1,
              totalSeats: 1,
              totalEv: 1,
              candidates: 1,
            },
          }
        )
        .toArray(),
    ]);
    // Opponent candidate rows -> characterId, so one rival is recognized across races.
    const opponentCandidateIds: ObjectId[] = [];
    for (const s of snapshots)
      for (const c of s.candidates ?? [])
        if (!c.isNPP && ObjectId.isValid(c.id)) opponentCandidateIds.push(new ObjectId(c.id));
    const identities = opponentCandidateIds.length
      ? await db
          .collection("electionCandidates")
          .find({ _id: { $in: opponentCandidateIds } }, { projection: { characterId: 1 } })
          .toArray()
      : [];
    return { candidacies, elections, snapshots, identities };
  });

  const electionById = new Map<string, ElectionRow>();
  for (const e of raceData?.elections ?? []) electionById.set(String(e._id), e);
  const electionTurns = new Map<string, number>();
  for (const [id, e] of electionById)
    if (typeof e.endTurn === "number") electionTurns.set(id, e.endTurn);

  for (const c of targets) {
    await section("career", warn, undefined, async () => {
      set(String(c._id), buildCareer(c.careerHistory, clock, electionTurns));
    });
  }

  const racesByChar = new Map<string, RecapRaces>();
  if (raceData) {
    await section("races-assemble", warn, undefined, async () => {
      const snapshotByElection = new Map<string, SnapshotRow>();
      for (const s of raceData.snapshots) snapshotByElection.set(String(s.electionId), s);
      const identity = new Map<string, string>();
      for (const row of raceData.identities)
        if (row.characterId) identity.set(String(row._id), String(row.characterId));
      const charById = new Map(targets.map((c) => [String(c._id), c]));
      const inputs = new Map<string, RaceInput[]>();
      for (const cand of raceData.candidacies) {
        const charId = String(cand.characterId);
        const character = charById.get(charId);
        const electionId = String(cand.electionId);
        const snap = snapshotByElection.get(electionId);
        if (!character || !snap) continue;
        if (!snap.candidates.some((x) => x.id === String(cand._id))) continue;
        const election = electionById.get(electionId);
        const career = (character.careerHistory ?? []).find(
          (e) => e.electionId && String(e.electionId) === electionId
        );
        const region = election?.state ?? null;
        const list = inputs.get(charId) ?? [];
        list.push({
          electionId,
          candidateId: String(cand._id),
          label: career?.officeLabel ?? officeLabelFor(snap.countryId, snap.electionType, region),
          year: snap.electionYear ?? election?.electionYear ?? null,
          turn: election?.endTurn ?? null,
          region,
          seats: snap.totalSeats ?? election?.totalSeats ?? 1,
          isPresidential: typeof snap.totalEv === "number" && snap.totalEv > 0,
          careerWon:
            career?.type === "elected" ? true : career?.type === "lost_election" ? false : null,
          candidates: snap.candidates,
        });
        inputs.set(charId, list);
      }
      for (const [charId, list] of inputs) {
        const races = buildRaces(list, identity);
        if (races) {
          racesByChar.set(charId, races);
          set(charId, { races });
        }
      }
    });
  }

  // ── Legislation ──────────────────────────────────────────────────────────
  let billsPassedWorld = 0;
  await section("legislation", warn, undefined, async () => {
    const projection = {
      title: 1,
      status: 1,
      sponsorId: 1,
      votes: 1,
      otherChamberVotes: 1,
      votesFor: 1,
      votesAgainst: 1,
      votesAbstain: 1,
      otherChamberVotesFor: 1,
      otherChamberVotesAgainst: 1,
      otherChamberVotesAbstain: 1,
      voteSnapshot: 1,
      otherChamberVoteSnapshot: 1,
      votingEndsOnTurn: 1,
      proposedTurn: 1,
    };
    const [bills, stateBills, npps] = await Promise.all([
      db.collection<BillRow>("bills").find({}, { projection }).toArray(),
      db.collection<BillRow>("stateBills").find({}, { projection }).toArray(),
      db
        .collection<Document>("npps")
        .find({}, { projection: { party: 1, countryId: 1 } })
        .toArray(),
    ]);
    const party = new Map<string, string>();
    for (const c of field) if (c.party) party.set(String(c._id), `${c.countryId}:${c.party}`);
    for (const n of npps)
      if (n.party) party.set(`npp_${String(n._id)}`, `${n.countryId}:${n.party}`);
    const partyOf = (key: string) => party.get(key) ?? null;

    billsPassedWorld = bills.filter((b) => PASSED.has(b.status)).length;
    const rows: BillVoteRow[] = [];
    for (const b of [...bills, ...stateBills]) {
      const passed = PASSED.has(b.status);
      const chambers = billChambers(b);
      const sponsorId = b.sponsorId ? String(b.sponsorId) : null;
      const touches =
        (sponsorId && idSet.has(sponsorId)) ||
        chambers.some((ch) => Object.keys(ch.votes).some((k) => idSet.has(k)));
      if (!touches) continue;
      const turn = b.voteSnapshot?.resolvedAtTurn ?? b.votingEndsOnTurn ?? b.proposedTurn;
      rows.push({
        title: b.title ?? "Untitled bill",
        passed,
        failedOnFloor: b.status === "failed",
        year: typeof turn === "number" ? dateOfTurn(turn, clock).year : null,
        sponsorId,
        chambers,
      });
    }
    for (const c of targets) {
      const id = String(c._id);
      const legislation = buildLegislation(id, rows, partyOf);
      if (legislation) set(id, { legislation });
    }
  });

  // ── Wealth ───────────────────────────────────────────────────────────────
  await section("wealth", warn, undefined, async () => {
    const rows = await db
      .collection("portfolioHistory")
      .aggregate<{ _id: { c: ObjectId; b: number }; v: number; t: number }>([
        { $match: { characterId: { $in: ids } } },
        {
          $group: {
            _id: { c: "$characterId", b: { $floor: { $divide: ["$turn", 4] } } },
            v: { $avg: { $ifNull: ["$netValue", "$totalValue"] } },
            t: { $min: "$turn" },
          },
        },
      ])
      .toArray();
    const rateMap = await fetchExchangeRateMap(db);
    const byChar = new Map<string, Array<[number, number]>>();
    for (const r of rows) {
      if (typeof r.v !== "number" || !Number.isFinite(r.v)) continue;
      const id = String(r._id.c);
      byChar.set(id, [...(byChar.get(id) ?? []), [r.t, r.v]]);
    }
    for (const c of targets) {
      const series = byChar.get(String(c._id));
      if (!series) continue;
      const rate = rateFromDoc(getRateDoc(rateMap, c.countryId as CountryId));
      const local = series.map(([t, v]) => [t, v * rate] as [number, number]);
      const wealth = buildWealth(local, clock);
      if (wealth) set(String(c._id), { wealth });
    }
  });

  // ── Corporation ──────────────────────────────────────────────────────────
  await section("corporation", warn, undefined, async () => {
    const corps = await db
      .collection<Document>("corporations")
      .find(
        { $or: [{ ceoId: { $in: ids } }, { "ceoHistory.holderId": { $in: ids } }] },
        {
          projection: {
            name: 1,
            tickerSymbol: 1,
            ceoId: 1,
            ceoHistory: 1,
            sharePrice: 1,
            totalShares: 1,
          },
        }
      )
      .toArray();
    const best = new Map<string, RecapCorporation>();
    for (const corp of corps) {
      const tenures = new Map<string, number>();
      for (const t of (corp.ceoHistory ?? []) as Array<{
        holderId: ObjectId;
        startTurn: number;
        endTurn?: number;
      }>) {
        const id = String(t.holderId);
        if (!idSet.has(id)) continue;
        tenures.set(
          id,
          (tenures.get(id) ?? 0) + Math.max(0, (t.endTurn ?? ctx.currentTurn) - t.startTurn)
        );
      }
      if (corp.ceoId && idSet.has(String(corp.ceoId)) && !tenures.has(String(corp.ceoId)))
        tenures.set(String(corp.ceoId), 0);
      const marketCap = (Number(corp.sharePrice) || 0) * (Number(corp.totalShares) || 0);
      for (const [id, turns] of tenures) {
        const prev = best.get(id);
        if (!prev || marketCap > prev.marketCap)
          best.set(id, {
            name: String(corp.name ?? "Corporation"),
            ticker: corp.tickerSymbol ? String(corp.tickerSymbol) : null,
            turnsAsCeo: turns,
            marketCap,
          });
      }
    }
    for (const [id, corporation] of best) set(id, { corporation });
  });

  // ── World ────────────────────────────────────────────────────────────────
  let world: RecapWorld | null = null;
  if (opts.includeWorld) {
    world = await section("world", warn, null, async () => {
      const [electionsHeld, conflicts, crises] = await Promise.all([
        db.collection("elections").countDocuments({ status: { $in: FINISHED_ELECTION } }),
        db.collection("conflicts").countDocuments({}),
        db.collection("crises").countDocuments({}),
      ]);
      let closestRace: RecapWorld["closestRace"] = null;
      for (const races of racesByChar.values()) {
        const r = races.closest ?? races.bestWin;
        if (!r || r.seats !== 1) continue;
        const winner = r.won
          ? r.field.find((f) => f.isYou)
          : [...r.field].sort((a, b) => b.votes - a.votes)[0];
        if (!winner) continue;
        const margin = Math.abs(r.marginVotes);
        if (!closestRace || margin < closestRace.marginVotes)
          closestRace = { label: r.label, year: r.year, winner: winner.name, marginVotes: margin };
      }
      return {
        startYear: dateOfTurn(1, clock).year,
        endYear: dateOfTurn(ctx.currentTurn, clock).year,
        turns: ctx.currentTurn,
        players: field.length,
        countries: new Set(field.map((c) => c.countryId)).size,
        electionsHeld,
        billsPassed: billsPassedWorld,
        conflicts,
        crises,
        closestRace,
      };
    });
  }

  return { perCharacter, world };
}

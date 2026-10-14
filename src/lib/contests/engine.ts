/**
 * Weekly contests, run after each turn commits: opens a round per kind with a
 * baseline snapshot, refreshes standings each turn, and when a round's week is
 * up pays the leader a cash prize and opens the next round (runContestsAfterTurn).
 */
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import * as Sentry from "@sentry/nextjs";
import type {
  Bill,
  Character,
  Corporation,
  ElectedOfficial,
  Election,
  ElectionCandidate,
  GovernmentApproval,
  PlayerEndorsement,
  PoliticalParty,
  State,
  User,
} from "@/lib/db/types";
import type { StateApprovalHistory } from "@/lib/db/types/stateApproval";
import { resolveExecutiveOffice } from "@/lib/states/regionalExecutive";
import { getStateDisplayName } from "@/lib/commodity-map/commodityRegionMappings";
import type { StateBill } from "@/lib/db/types/stateBill";
import type { CorporationHistory } from "@/lib/db/types/corporationHistory";
import type {
  ContestBaseline,
  ContestKind,
  ContestRound,
  ContestStanding,
  ContestWinner,
} from "@/lib/db/types/contestRound";
import type { CountryId } from "@/lib/constants/countries";
import { getCountryDisplayName } from "@/lib/constants/countries";
import type { GameState } from "@/lib/db/types/gameState";
import type { AltLink } from "@/lib/db/types/altDetection";
import { getHeadOfGovernmentCharacterIds } from "@/lib/api/headOfGovernment";
import {
  CONTEST_KINDS,
  CONTEST_ROUND_MS,
  CORP_CONTEST_KINDS,
  approvalEntryEligible,
  comebackEligible,
  countKingmakerCalls,
  lowerHalfIds,
  rookieEligible,
  contestRoundId,
  corpGrowthScore,
  corpMinOpeningAnchor,
  gainScore,
  pickPlacings,
  rankStandings,
  roundBelongsToEarlierWorld,
  roundIsDue,
  splitCorpTiers,
  wealthMinOpeningAnchor,
  altPairKey,
  countWeeklyReferrals,
  REFERRAL_ALT_LINK_THRESHOLD,
  iterationChanged,
  type CorpOpening,
  type KingmakerEndorsement,
  type ResolvedRace,
} from "./rules";
import { reconcileContestAchievements } from "./achievements";
import { awardReferralContest } from "./referralAward";
import { payContestPrize } from "./prize";
import { loadCharacterNetWorths, loadExternalInflows } from "./netWorth";
import { announceContestResults, type SettledRoundResult } from "./announce";
import { getContestRoundsCollection } from "./collection";

type PlayerCharacter = Pick<
  Character,
  "_id" | "userId" | "name" | "countryId" | "nationalInfluence" | "sequentialId" | "favorability"
> &
  Partial<Pick<Character, "createdAt">>;

interface ContestWorld {
  turn: number;
  now: Date;
  preset: string | undefined;
  iterationKey: string | undefined;
  /** When the current world was reset into being; the iteration contest counts from here. */
  epochStartedAt: Date | undefined;
  players: Map<string, PlayerCharacter>;
  /** Player character by user id. */
  playersByUser: Map<string, PlayerCharacter>;
}

const contestRounds = getContestRoundsCollection;

/** Live player characters whose accounts are not banned. */
async function loadPlayers(db: Db): Promise<Map<string, PlayerCharacter>> {
  const characters = await db
    .collection<Character>("characters")
    .find(
      { isSynthetic: { $ne: true } },
      {
        projection: {
          _id: 1,
          userId: 1,
          name: 1,
          countryId: 1,
          nationalInfluence: 1,
          sequentialId: 1,
          favorability: 1,
          createdAt: 1,
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

type ApprovalSnapshot = Pick<GovernmentApproval, "approvalRating"> &
  Partial<Pick<GovernmentApproval, "history" | "headOfGovernmentSinceTurn">>;

async function loadApprovals(db: Db): Promise<Map<string, ApprovalSnapshot>> {
  const docs = await db
    .collection<GovernmentApproval>("governmentApprovals")
    .find(
      {},
      { projection: { _id: 1, approvalRating: 1, history: 1, headOfGovernmentSinceTurn: 1 } }
    )
    .toArray();
  return new Map<string, ApprovalSnapshot>(docs.map((d) => [String(d._id), d] as const));
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

interface PartyRow {
  partyId: string;
  name: string;
  chairId: string | null;
  memberCount: number;
}

/** Parties by id, or every party when no ids are given. */
async function loadParties(db: Db, partyIds?: string[]): Promise<Map<string, PartyRow>> {
  const docs = await db
    .collection<PoliticalParty>("politicalParties")
    .find(partyIds ? { _id: { $in: partyIds.map((id) => new ObjectId(id)) } } : {}, {
      projection: { _id: 1, name: 1, chairId: 1, memberCount: 1 },
    })
    .toArray();
  return new Map(
    docs.map((p) => [
      p._id.toString(),
      {
        partyId: p._id.toString(),
        name: p.name,
        chairId: p.chairId?.toString() ?? null,
        memberCount: p.memberCount ?? 0,
      },
    ])
  );
}

/** Bills each player sponsored that were enacted in (since, until], national and state. */
async function loadEnactedBillCounts(
  db: Db,
  world: ContestWorld,
  since: Date,
  until: Date
): Promise<Map<string, number>> {
  const window = { $gt: since, $lte: until };
  const [national, state] = await Promise.all([
    db
      .collection<Bill>("bills")
      .find(
        { status: "signed", enactedAt: window, sponsorId: { $ne: null } },
        { projection: { sponsorId: 1 } }
      )
      .toArray(),
    db
      .collection<StateBill>("stateBills")
      .find({ enactedAt: window, sponsorId: { $ne: null } }, { projection: { sponsorId: 1 } })
      .toArray(),
  ]);
  const counts = new Map<string, number>();
  for (const bill of [...national, ...state]) {
    const id = bill.sponsorId?.toString();
    if (!id || !world.players.has(id)) continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

/**
 * Each player corporation's market cap about a week ago, in its own currency:
 * the latest snapshot written in the day before the one-week mark.
 */
async function loadWeekAgoCaps(
  db: Db,
  world: ContestWorld,
  corporationIds: string[]
): Promise<Map<string, number>> {
  const caps = new Map<string, number>();
  if (corporationIds.length === 0) return caps;
  const weekAgo = world.now.getTime() - CONTEST_ROUND_MS;
  const rows = await db
    .collection<CorporationHistory>("corporationHistory")
    .find(
      {
        corporationId: { $in: corporationIds.map((id) => new ObjectId(id)) },
        createdAt: { $gte: new Date(weekAgo - 24 * 60 * 60 * 1000), $lte: new Date(weekAgo) },
      },
      { projection: { corporationId: 1, marketCap: 1, createdAt: 1 } }
    )
    .sort({ createdAt: 1 })
    .toArray();
  // Ascending, so the last row seen per corporation is the one nearest the mark.
  for (const row of rows) {
    if (Number.isFinite(row.marketCap)) caps.set(row.corporationId.toString(), row.marketCap);
  }
  return caps;
}

const REGIONAL_EXECUTIVE_OFFICES = ["governor", "ministerPresident"];

interface StateExecutiveRow {
  stateId: string;
  countryId: CountryId;
  characterId: string | null;
}

/**
 * The sitting regional executive of every state that has one, keyed by state
 * id. Where stale rows overlap, the most recently elected holder counts, as
 * getRegionalExecutive decides.
 */
async function loadStateExecutives(db: Db): Promise<Map<string, StateExecutiveRow>> {
  const officials = await db
    .collection<ElectedOfficial>("electedOfficials")
    .find(
      { officeType: { $in: REGIONAL_EXECUTIVE_OFFICES } },
      { projection: { countryId: 1, state: 1, officeType: 1, characterId: 1, electedAt: 1 } }
    )
    .toArray();
  const latest = new Map<string, { row: StateExecutiveRow; electedAt: number }>();
  for (const o of officials) {
    if (!o.countryId || !o.state) continue;
    if (resolveExecutiveOffice(o.countryId, o.state)?.officeType !== o.officeType) continue;
    const electedAt = o.electedAt ? new Date(o.electedAt).getTime() : 0;
    const key = o.state.toUpperCase();
    const prior = latest.get(key);
    if (prior && prior.electedAt > electedAt) continue;
    latest.set(key, {
      electedAt,
      row: { stateId: key, countryId: o.countryId, characterId: o.characterId?.toString() ?? null },
    });
  }
  return new Map([...latest].map(([key, v]) => [key, v.row]));
}

async function loadStateApprovals(
  db: Db,
  stateIds: string[]
): Promise<Map<string, { approval: number; name: string }>> {
  if (stateIds.length === 0) return new Map();
  const [approvals, states] = await Promise.all([
    db
      .collection<StateApprovalHistory>("stateApprovalHistory")
      .find({ _id: { $in: stateIds } }, { projection: { _id: 1, countryId: 1, approvalRating: 1 } })
      .toArray(),
    db
      .collection<State>("states")
      .find({ _id: { $in: stateIds } }, { projection: { _id: 1, name: 1 } })
      .toArray(),
  ]);
  const names = new Map(states.map((st) => [st._id, st.name]));
  const out = new Map<string, { approval: number; name: string }>();
  for (const a of approvals) {
    if (!Number.isFinite(a.approvalRating)) continue;
    out.set(a._id, {
      approval: a.approvalRating,
      name: names.get(a._id) || getStateDisplayName(a.countryId, a._id),
    });
  }
  return out;
}

const candidateKey = (c: {
  isNPP?: boolean;
  nppId?: ObjectId | null;
  characterId?: ObjectId | null;
}) =>
  c.isNPP && c.nppId
    ? `n:${c.nppId.toString()}`
    : c.characterId
      ? `c:${c.characterId.toString()}`
      : null;

/**
 * Races called by each player since the round opened: races that closed after
 * the opening turn whose endorsed candidate took office during the round.
 */
async function loadKingmakerCalls(
  db: Db,
  world: ContestWorld,
  round: Pick<ContestRound, "startTurn" | "startedAt">
): Promise<Map<string, number>> {
  const elections = await db
    .collection<Election>("elections")
    .find(
      {
        status: { $in: ["completed", "resolved"] },
        endTurn: { $gt: round.startTurn, $lte: world.turn },
      },
      { projection: { _id: 1, countryId: 1, endTime: 1 } }
    )
    .toArray();
  if (elections.length === 0) return new Map();

  const electionIds = elections.map((e) => e._id);
  const endorsements = await db
    .collection<PlayerEndorsement>("playerEndorsements")
    .find(
      { electionId: { $in: electionIds }, characterId: { $in: playerObjectIds(world) } },
      {
        projection: { characterId: 1, electionId: 1, candidateId: 1, createdAt: 1, withdrawnAt: 1 },
      }
    )
    .toArray();
  if (endorsements.length === 0) return new Map();

  const [candidates, officials] = await Promise.all([
    db
      .collection<ElectionCandidate>("electionCandidates")
      .find(
        { _id: { $in: endorsements.map((e) => e.candidateId) } },
        { projection: { _id: 1, characterId: 1, isNPP: 1, nppId: 1 } }
      )
      .toArray(),
    db
      .collection<ElectedOfficial>("electedOfficials")
      .find(
        {
          electedAt: { $gt: round.startedAt, $lte: world.now },
          isAppointment: { $ne: true },
        },
        { projection: { countryId: 1, characterId: 1, nppId: 1, isNPP: 1 } }
      )
      .toArray(),
  ]);
  const keyByCandidate = new Map(candidates.map((c) => [c._id.toString(), candidateKey(c)]));
  const winnersByCountry = new Map<string, Set<string>>();
  for (const o of officials) {
    const key = o.nppId
      ? `n:${o.nppId.toString()}`
      : o.characterId
        ? `c:${o.characterId.toString()}`
        : null;
    if (!key || !o.countryId) continue;
    const set = winnersByCountry.get(o.countryId) ?? new Set<string>();
    set.add(key);
    winnersByCountry.set(o.countryId, set);
  }

  const races = new Map<string, ResolvedRace>();
  for (const e of elections) {
    races.set(e._id.toString(), {
      endsAtMs: e.endTime ? new Date(e.endTime).getTime() : null,
      winnerKeys: winnersByCountry.get(e.countryId) ?? new Set(),
    });
  }
  const rows: KingmakerEndorsement[] = [];
  for (const e of endorsements) {
    const key = keyByCandidate.get(e.candidateId.toString());
    if (!key) continue;
    rows.push({
      endorserId: e.characterId.toString(),
      electionId: e.electionId.toString(),
      candidateKey: key,
      createdAtMs: new Date(e.createdAt).getTime(),
      withdrawnAtMs: e.withdrawnAt ? new Date(e.withdrawnAt).getTime() : null,
    });
  }
  return countKingmakerCalls(rows, races, new Set(world.players.keys()));
}

/** A character entry scored on absolute gain in one of its own fields. */
function characterGainStandings(
  world: ContestWorld,
  baselines: readonly ContestBaseline[],
  read: (c: PlayerCharacter) => number
): ContestStanding[] {
  const standings: ContestStanding[] = [];
  for (const b of baselines) {
    const c = world.players.get(b.characterId);
    if (!c) continue;
    const current = read(c);
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
  return rankStandings(standings);
}

const influenceOf = (c: PlayerCharacter) => c.nationalInfluence ?? 0;
const favorabilityOf = (c: PlayerCharacter) => c.favorability ?? 0;

const playerObjectIds = (world: ContestWorld, ids?: string[]) =>
  (ids ?? [...world.players.keys()]).map((id) => new ObjectId(id));

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

  if (kinds.includes("corp_comeback")) {
    const corps = await loadCorpRows(db, world);
    const weekAgo = await loadWeekAgoCaps(db, world, [...corps.keys()]);
    const floor = corpMinOpeningAnchor(world.preset);
    out.set("corp_comeback", {
      baselines: [...corps.values()]
        .filter(
          (c) =>
            c.capAnchor >= floor && comebackEligible(weekAgo.get(c.corporationId) ?? 0, c.capLocal)
        )
        .map((c) => ({
          subjectId: c.corporationId,
          characterId: c.ceoCharacterId,
          value: c.capLocal,
          injected: 0,
        })),
    });
  }

  const characterBaseline = (c: PlayerCharacter, value: number): ContestBaseline => ({
    subjectId: c._id.toString(),
    characterId: c._id.toString(),
    value,
  });
  const players = [...world.players.values()];

  if (kinds.includes("influence_gain")) {
    out.set("influence_gain", {
      baselines: players.map((c) => characterBaseline(c, influenceOf(c))),
    });
  }

  if (kinds.includes("rookie_influence")) {
    out.set("rookie_influence", {
      baselines: players
        .filter((c) => rookieEligible(c.createdAt?.getTime(), world.now.getTime()))
        .map((c) => characterBaseline(c, influenceOf(c))),
    });
  }

  if (kinds.includes("backbench_influence")) {
    const lower = lowerHalfIds(
      players.map((c) => ({ id: c._id.toString(), value: influenceOf(c) }))
    );
    out.set("backbench_influence", {
      baselines: players
        .filter((c) => lower.has(c._id.toString()))
        .map((c) => characterBaseline(c, influenceOf(c))),
    });
  }

  if (kinds.includes("favorability_gain")) {
    out.set("favorability_gain", {
      baselines: players.map((c) => characterBaseline(c, favorabilityOf(c))),
    });
  }

  if (kinds.includes("governor_approval")) {
    const executives = [...(await loadStateExecutives(db)).values()].filter(
      (e) => e.characterId && world.players.has(e.characterId)
    );
    const approvals = await loadStateApprovals(
      db,
      executives.map((e) => e.stateId)
    );
    out.set("governor_approval", {
      baselines: executives
        .filter((e) => approvals.has(e.stateId))
        .map((e) => ({
          subjectId: e.stateId,
          characterId: e.characterId!,
          value: approvals.get(e.stateId)!.approval,
        })),
    });
  }

  if (kinds.includes("approval_gain")) {
    const approvals = await loadApprovals(db);
    const heads = await loadPlayerHeads(db, world, [...approvals.keys()]);
    const baselines: ContestBaseline[] = [];
    for (const [countryId, approval] of approvals) {
      const head = heads.get(countryId);
      if (!head || !Number.isFinite(approval.approvalRating)) continue;
      baselines.push({ subjectId: countryId, characterId: head, value: approval.approvalRating });
    }
    out.set("approval_gain", { baselines });
  }

  if (kinds.includes("wealth_growth")) {
    const worths = await loadCharacterNetWorths(db, playerObjectIds(world));
    const floor = wealthMinOpeningAnchor(world.preset);
    out.set("wealth_growth", {
      baselines: [...worths]
        .filter(([, value]) => value >= floor)
        .map(([id, value]) => ({ subjectId: id, characterId: id, value, injected: 0 })),
    });
  }

  if (kinds.includes("party_growth")) {
    const parties = await loadParties(db);
    out.set("party_growth", {
      baselines: [...parties.values()]
        .filter((p) => p.chairId && world.players.has(p.chairId))
        .map((p) => ({ subjectId: p.partyId, characterId: p.chairId!, value: p.memberCount })),
    });
  }

  // Legislator, kingmaker and referral rounds count from the opening; there is no baseline.
  if (kinds.includes("legislator_bills")) out.set("legislator_bills", { baselines: [] });
  if (kinds.includes("kingmaker")) out.set("kingmaker", { baselines: [] });
  if (kinds.includes("referrals_weekly")) out.set("referrals_weekly", { baselines: [] });

  return out;
}

/**
 * End time for rounds opening now. A round opening while the other weekly
 * rounds have at least half a week left joins their week, so every contest
 * settles together and the results go out in one post; otherwise it runs a
 * full week. Rounds opened off-cycle (a new contest kind, a missed settlement)
 * fall into step within one round.
 */
async function sharedWeekEnd(db: Db, world: ContestWorld, opening: ContestKind[]): Promise<Date> {
  const fullWeek = new Date(world.now.getTime() + CONTEST_ROUND_MS);
  const others = await contestRounds(db)
    .find(
      {
        status: "active",
        kind: { $in: CONTEST_KINDS.filter((k) => !opening.includes(k)) },
        endsAt: { $gte: new Date(world.now.getTime() + CONTEST_ROUND_MS / 2) },
      },
      { projection: { endsAt: 1 } }
    )
    .toArray();
  const latest = Math.max(...others.map((r) => r.endsAt.getTime()));
  return Number.isFinite(latest) && latest <= fullWeek.getTime() ? new Date(latest) : fullWeek;
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
  const endsAt = await sharedWeekEnd(db, world, kinds);
  let opened = 0;
  for (const kind of kinds) {
    const roundNumber = (lastNumber.get(kind) ?? 0) + 1;
    const opening = baselines.get(kind) ?? { baselines: [] };
    const round: ContestRound = {
      _id: contestRoundId(kind, roundNumber),
      kind,
      roundNumber,
      status: "active",
      startedAt: world.now,
      endsAt,
      startTurn: world.turn,
      ...(world.iterationKey ? { iterationKey: world.iterationKey } : {}),
      ...(opening.tierBoundaryAnchor !== undefined
        ? { tierBoundaryAnchor: opening.tierBoundaryAnchor }
        : {}),
      baselines: opening.baselines,
      standings: [],
      winners: [],
    };
    try {
      await contestRounds(db).insertOne(round);
      opened++;
    } catch (err) {
      // Duplicate id: another process opened this round first.
      if ((err as { code?: number }).code !== 11000) throw err;
      continue;
    }
    // Standings exist from the moment a round opens, so the field shows
    // straight away instead of an empty card until the next turn.
    const { standings } = await computeStandings(db, world, round);
    await contestRounds(db).updateOne(
      { _id: round._id, status: "active" },
      { $set: { standings, standingsTurn: world.turn, refreshedAt: world.now } }
    );
  }
  return opened;
}

// ── Standings ───────────────────────────────────────────────────────────────

async function computeStandings(
  db: Db,
  world: ContestWorld,
  round: ContestRound
): Promise<{ standings: ContestStanding[]; baselines: ContestBaseline[] }> {
  const result = await computeRawStandings(db, world, round);
  return {
    ...result,
    standings: result.standings.map((entry) => ({
      ...entry,
      userId: world.players.get(entry.characterId)?.userId.toString(),
    })),
  };
}

async function computeRawStandings(
  db: Db,
  world: ContestWorld,
  round: ContestRound
): Promise<{ standings: ContestStanding[]; baselines: ContestBaseline[] }> {
  const kind = round.kind as ContestKind;
  const standings: ContestStanding[] = [];
  const baselines = round.baselines;

  if (CORP_CONTEST_KINDS.includes(kind)) {
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

  if (kind === "influence_gain" || kind === "rookie_influence" || kind === "backbench_influence") {
    return { standings: characterGainStandings(world, baselines, influenceOf), baselines };
  }

  if (kind === "favorability_gain") {
    return { standings: characterGainStandings(world, baselines, favorabilityOf), baselines };
  }

  if (kind === "governor_approval") {
    const [executives, approvals] = await Promise.all([
      loadStateExecutives(db),
      loadStateApprovals(
        db,
        baselines.map((b) => b.subjectId)
      ),
    ]);
    for (const b of baselines) {
      const state = approvals.get(b.subjectId);
      const sitting = executives.get(b.subjectId)?.characterId ?? null;
      if (!state || !approvalEntryEligible(b.characterId, sitting)) continue;
      const governor = world.players.get(b.characterId);
      if (!governor) continue;
      const score = gainScore(b.value, state.approval);
      if (score === null) continue;
      standings.push({
        subjectId: b.subjectId,
        subjectName: state.name,
        characterId: b.characterId,
        characterName: governor.name,
        baseline: b.value,
        current: state.approval,
        score,
      });
    }
    return { standings: rankStandings(standings), baselines };
  }

  if (kind === "kingmaker") {
    const calls = await loadKingmakerCalls(db, world, round);
    for (const [characterId, count] of calls) {
      const c = world.players.get(characterId)!;
      standings.push({
        subjectId: characterId,
        subjectName: c.name,
        characterId,
        characterName: c.name,
        baseline: 0,
        current: count,
        score: count,
      });
    }
    return { standings: rankStandings(standings), baselines };
  }

  if (kind === "wealth_growth") {
    const ids = baselines.map((b) => b.subjectId);
    const since = round.refreshedAt ?? round.startedAt;
    const [worths, fresh] = await Promise.all([
      loadCharacterNetWorths(db, playerObjectIds(world, ids)),
      loadExternalInflows(db, playerObjectIds(world, ids), since, world.now),
    ]);
    // Inflows accumulate across refreshes, as corp injections do.
    const updated = baselines.map((b) => ({
      ...b,
      injected: (b.injected ?? 0) + (fresh.get(b.subjectId) ?? 0),
    }));
    for (const b of updated) {
      const c = world.players.get(b.characterId);
      const current = worths.get(b.subjectId);
      if (!c || current === undefined) continue;
      const score = corpGrowthScore(b.value, current, b.injected ?? 0);
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
    return { standings: rankStandings(standings), baselines: updated };
  }

  if (kind === "party_growth") {
    const parties = await loadParties(
      db,
      baselines.map((b) => b.subjectId)
    );
    for (const b of baselines) {
      const party = parties.get(b.subjectId);
      if (!party || !approvalEntryEligible(b.characterId, party.chairId)) continue;
      const chair = world.players.get(b.characterId);
      if (!chair) continue;
      const score = gainScore(b.value, party.memberCount);
      if (score === null) continue;
      standings.push({
        subjectId: b.subjectId,
        subjectName: party.name,
        characterId: b.characterId,
        characterName: chair.name,
        baseline: b.value,
        current: party.memberCount,
        score,
      });
    }
    return { standings: rankStandings(standings), baselines };
  }

  if (kind === "legislator_bills") {
    const counts = await loadEnactedBillCounts(db, world, round.startedAt, world.now);
    for (const [characterId, count] of counts) {
      const c = world.players.get(characterId)!;
      standings.push({
        subjectId: characterId,
        subjectName: c.name,
        characterId,
        characterName: c.name,
        baseline: 0,
        current: count,
        score: count,
      });
    }
    return { standings: rankStandings(standings), baselines };
  }

  if (kind === "referrals_weekly") {
    return {
      standings: await referralStandings(db, world.playersByUser, round.startedAt),
      baselines,
    };
  }

  // approval_gain
  const approvals = await loadApprovals(db);
  const heads = await loadPlayerHeads(db, world, [...approvals.keys()]);
  const existingByCountry = new Map(baselines.map((baseline) => [baseline.subjectId, baseline]));
  const updatedBaselines: ContestBaseline[] = [];
  for (const [countryId, approval] of approvals) {
    const head = heads.get(countryId) ?? null;
    if (!head) continue;

    const existing = existingByCountry.get(countryId);
    let baseline = existing;
    if (!existing || !approvalEntryEligible(existing.characterId, head)) {
      const officeTurn = approval.headOfGovernmentSinceTurn;
      const officeApproval =
        officeTurn === undefined || officeTurn === null
          ? undefined
          : approval.history?.find((entry) => entry.turn === officeTurn)?.approval;
      const hasOfficeApproval = officeApproval !== undefined && Number.isFinite(officeApproval);
      const value = hasOfficeApproval ? officeApproval : approval.approvalRating;
      if (!Number.isFinite(value)) continue;
      baseline = {
        subjectId: countryId,
        characterId: head,
        value,
        enteredTurn: hasOfficeApproval ? (officeTurn ?? world.turn) : world.turn,
      };
    }

    if (!baseline) continue;
    updatedBaselines.push(baseline);
    if (!Number.isFinite(approval.approvalRating)) continue;
    const c = world.players.get(head);
    if (!c) continue;
    const score = gainScore(baseline.value, approval.approvalRating);
    if (score === null) continue;
    standings.push({
      subjectId: countryId,
      subjectName: getCountryDisplayName(countryId as CountryId, world.preset),
      characterId: head,
      characterName: c.name,
      baseline: baseline.value,
      current: approval.approvalRating,
      score,
    });
  }
  return { standings: rankStandings(standings), baselines: updatedBaselines };
}

/**
 * Referrers ranked by new players who created a character since `since`.
 * Banned referees and strong alt links between referrer and referee do not
 * count. Weekly rounds and the iteration contest both use this.
 */
export async function referralStandings(
  db: Db,
  playersByUser: ReadonlyMap<string, PlayerCharacter>,
  since: Date
): Promise<ContestStanding[]> {
  const fresh = await db
    .collection<Character>("characters")
    .find({ createdAt: { $gte: since } }, { projection: { userId: 1 } })
    .toArray();
  if (fresh.length === 0) return [];
  const referees = await db
    .collection<User>("users")
    .find(
      { _id: { $in: fresh.map((c) => c.userId) }, referredBy: { $exists: true } },
      { projection: { _id: 1, referredBy: 1, isBanned: 1 } }
    )
    .toArray();
  const referrerIds = [
    ...new Set(referees.map((r) => r.referredBy?.toString()).filter((id): id is string => !!id)),
  ];
  if (referrerIds.length === 0) return [];

  const links = await db
    .collection<AltLink>("altLinks")
    .find(
      {
        confidence: { $gte: REFERRAL_ALT_LINK_THRESHOLD },
        $or: [
          { userA: { $in: referrerIds.map((id) => new ObjectId(id)) } },
          { userB: { $in: referrerIds.map((id) => new ObjectId(id)) } },
        ],
      },
      { projection: { userA: 1, userB: 1 } }
    )
    .toArray();
  const altPairs = new Set(links.map((l) => altPairKey(l.userA.toString(), l.userB.toString())));

  const counts = countWeeklyReferrals(
    referees.map((r) => ({
      refereeUserId: r._id.toString(),
      referrerUserId: r.referredBy!.toString(),
      refereeBanned: r.isBanned === true,
    })),
    new Set(playersByUser.keys()),
    altPairs
  );

  const standings: ContestStanding[] = [];
  for (const [referrerUserId, count] of counts) {
    const character = playersByUser.get(referrerUserId);
    if (!character) continue;
    standings.push({
      userId: referrerUserId,
      subjectId: referrerUserId,
      subjectName: character.name,
      characterId: character._id.toString(),
      characterName: character.name,
      baseline: 0,
      current: count,
      score: count,
    });
  }
  return rankStandings(standings);
}

// ── Settlement ──────────────────────────────────────────────────────────────

async function settleRound(
  db: Db,
  world: ContestWorld,
  round: ContestRound
): Promise<SettledRoundResult | null> {
  const { standings, baselines } = await computeStandings(db, world, round);
  const kind = round.kind as ContestKind;
  const winners: ContestWinner[] = pickPlacings(kind, standings).map((s, i) => ({
    rank: i + 1,
    userId: s.userId,
    characterId: s.characterId,
    characterName: s.characterName,
    subjectId: s.subjectId,
    subjectName: s.subjectName,
    score: s.score,
  }));

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
        winners,
      },
    }
  );
  if (claim.modifiedCount !== 1) return null;

  for (const [i, winner] of winners.entries()) {
    const character = world.players.get(winner.characterId);
    if (!character) continue;
    try {
      const paid = await payContestPrize(db, {
        character,
        round: { _id: round._id, kind, roundNumber: round.roundNumber },
        subjectName: winner.subjectName,
        place: i + 1,
        turn: world.turn,
        preset: world.preset,
        now: world.now,
      });
      await contestRounds(db).updateOne(
        { _id: round._id },
        {
          $set: {
            [`winners.${i}.prizeAnchor`]: paid.anchorAmount,
            [`winners.${i}.prizeLocal`]: paid.localAmount,
            [`winners.${i}.currencyCode`]: paid.currencyCode,
            ...(paid.credited ? { [`winners.${i}.paidAt`]: world.now } : {}),
          },
        }
      );
      winners[i] = { ...winner, prizeAnchor: paid.anchorAmount };
    } catch (err) {
      Sentry.captureException(err, { tags: { area: "contests", round: round._id } });
      console.error(`[contests] prize payment failed for ${round._id} place ${i + 1}`, err);
    }
  }
  return { kind, roundNumber: round.roundNumber, standings, winners };
}

// ── Iteration referral contest ──────────────────────────────────────────────

const ITERATION_KIND = "referrals_iteration" as const;

async function openIterationRound(db: Db, world: ContestWorld, startedAt: Date): Promise<void> {
  const last = await contestRounds(db)
    .find({ kind: ITERATION_KIND }, { projection: { roundNumber: 1 } })
    .sort({ roundNumber: -1 })
    .limit(1)
    .toArray();
  const roundNumber = (last[0]?.roundNumber ?? 0) + 1;
  try {
    await contestRounds(db).insertOne({
      _id: contestRoundId(ITERATION_KIND, roundNumber),
      kind: ITERATION_KIND,
      roundNumber,
      status: "active",
      startedAt,
      endsAt: startedAt,
      startTurn: world.turn,
      ...(world.iterationKey ? { iterationKey: world.iterationKey } : {}),
      baselines: [],
      standings: await referralStandings(db, world.playersByUser, startedAt),
      refreshedAt: world.now,
      winners: [],
    });
  } catch (err) {
    // Duplicate id: another process opened this round first.
    if ((err as { code?: number }).code !== 11000) throw err;
  }
}

/**
 * Keep the iteration referral contest current. It counts from the moment the
 * world started, refreshes its standings every run, and when the world reports
 * a new iteration it awards the standings stored before the reset (the old
 * world's characters are retired by then) and opens the next contest from the
 * new world's start.
 */
async function runIterationReferrals(
  db: Db,
  world: ContestWorld
): Promise<"opened" | "awarded" | "running"> {
  const worldStart = world.epochStartedAt ?? world.now;
  const active = await contestRounds(db).findOne({ kind: ITERATION_KIND, status: "active" });

  if (!active) {
    await openIterationRound(db, world, worldStart);
    return "opened";
  }

  if (iterationChanged(active.iterationKey, world.iterationKey)) {
    await awardReferralContest(db, { awardedBy: "system", now: world.now });
    await openIterationRound(db, world, worldStart);
    return "awarded";
  }

  // A contest never starts before its world: a window carried over from an
  // older world is moved up to this world's start.
  const startedAt =
    world.epochStartedAt && active.startedAt < world.epochStartedAt
      ? world.epochStartedAt
      : active.startedAt;
  await contestRounds(db).updateOne(
    { _id: active._id, status: "active" },
    {
      $set: {
        startedAt,
        ...(!active.iterationKey && world.iterationKey ? { iterationKey: world.iterationKey } : {}),
        standings: await referralStandings(db, world.playersByUser, startedAt),
        refreshedAt: world.now,
      },
    }
  );
  return "running";
}

/**
 * Staff override: award the iteration referral contest now on fresh
 * standings, then start the next one from this moment.
 */
export async function awardIterationReferralsNow(db: Db, awardedBy: string, now = new Date()) {
  const [gameState, players] = await Promise.all([
    db
      .collection<GameState>("gameState")
      .findOne({ _id: "current" } as never, { projection: { iteration: 1, currentTurn: 1 } }),
    loadPlayers(db),
  ]);
  const world: ContestWorld = {
    turn: gameState?.currentTurn ?? 0,
    now,
    preset: undefined,
    iterationKey: gameState?.iteration
      ? `${gameState.iteration.type}:${gameState.iteration.number}`
      : undefined,
    epochStartedAt: undefined,
    players,
    playersByUser: new Map([...players.values()].map((c) => [c.userId.toString(), c])),
  };
  const active = await contestRounds(db).findOne({ kind: ITERATION_KIND, status: "active" });
  if (active) {
    await contestRounds(db).updateOne(
      { _id: active._id, status: "active" },
      {
        $set: {
          standings: await referralStandings(db, world.playersByUser, active.startedAt),
          refreshedAt: now,
        },
      }
    );
  }
  const result = await awardReferralContest(db, { awardedBy, now });
  await openIterationRound(db, world, now);
  return result;
}

// ── Entry point ─────────────────────────────────────────────────────────────

export interface ContestRunSummary {
  settled: number;
  voided: number;
  refreshed: number;
  opened: number;
  referrals?: "opened" | "awarded" | "running" | "failed";
}

declare global {
  var _ahdContestsRunning: boolean | undefined;
  var _ahdContestsOpenCheckedAt: number | undefined;
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
  const [gameState, players] = await Promise.all([
    db.collection<GameState>("gameState").findOne({ _id: "current" } as never, {
      projection: { preset: 1, iteration: 1, worldEpochStartedAt: 1 },
    }),
    loadPlayers(db),
  ]);
  const world: ContestWorld = {
    turn,
    now,
    preset: gameState?.preset,
    iterationKey: gameState?.iteration
      ? `${gameState.iteration.type}:${gameState.iteration.number}`
      : undefined,
    epochStartedAt: gameState?.worldEpochStartedAt ?? undefined,
    players,
    playersByUser: new Map([...players.values()].map((c) => [c.userId.toString(), c])),
  };

  const active = await contestRounds(db)
    .find({ status: "active", kind: { $in: [...CONTEST_KINDS] } })
    .toArray();

  const stillActive = new Set<string>();
  const settled: SettledRoundResult[] = [];
  for (const round of active) {
    const otherIteration =
      !!round.iterationKey && !!world.iterationKey && round.iterationKey !== world.iterationKey;
    if (otherIteration || roundBelongsToEarlierWorld(round.startTurn, turn)) {
      const res = await contestRounds(db).updateOne(
        { _id: round._id, status: "active" },
        { $set: { status: "void", settledAt: now, settledTurn: turn } }
      );
      summary.voided += res.modifiedCount;
      continue;
    }
    if (roundIsDue(round.endsAt.getTime(), now.getTime())) {
      const result = await settleRound(db, world, round);
      if (result) {
        summary.settled++;
        settled.push(result);
      }
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

  await announceContestResults(
    settled,
    new Map([...players.values()].map((c) => [c._id.toString(), c.userId]))
  );

  const missing = CONTEST_KINDS.filter((k) => !stillActive.has(k));
  summary.opened = await openRounds(db, world, missing);
  // The iteration referral award is separate state: its failure must not
  // stop the weekly rounds, which have already been written.
  try {
    summary.referrals = await runIterationReferrals(db, world);
  } catch (err) {
    summary.referrals = "failed";
    Sentry.captureException(err, { tags: { area: "contests", step: "iterationReferrals" } });
    console.error("[contests] iteration referral step failed", err);
  }
  try {
    await reconcileContestAchievements(db);
  } catch (err) {
    Sentry.captureException(err, { tags: { area: "contests", step: "achievements" } });
  }
  return summary;
}

/** Post-turn hook. Never throws and never overlaps itself within a process. */
export async function runContestsAfterTurn(db: Db, turn: number): Promise<void> {
  if (globalThis._ahdContestsRunning) return;
  globalThis._ahdContestsRunning = true;
  try {
    const summary = await runContests(db, turn);
    if (summary.settled || summary.opened || summary.voided || summary.referrals === "awarded") {
      console.log(
        `[contests] turn ${turn}: settled ${summary.settled}, opened ${summary.opened}, voided ${summary.voided}, referrals ${summary.referrals}`
      );
    }
  } catch (err) {
    Sentry.captureException(err, { tags: { area: "contests" } });
    console.error("[contests] post-turn run failed", err);
  } finally {
    globalThis._ahdContestsRunning = false;
  }
}

/** How often one process may check for missing rounds from a page view. */
const OPEN_CHECK_INTERVAL_MS = 60_000;

/**
 * Open any missing weekly rounds without waiting for a turn: called from the
 * Contests page so a fresh deploy or a reset world has live contests on the
 * first visit. Throttled per process, never throws, and shares the turn hook's
 * in-process guard; round ids keep it safe against the turn worker.
 */
export async function ensureContestsOpen(db: Db, now: Date = new Date()): Promise<void> {
  const last = globalThis._ahdContestsOpenCheckedAt ?? 0;
  if (now.getTime() - last < OPEN_CHECK_INTERVAL_MS) return;
  globalThis._ahdContestsOpenCheckedAt = now.getTime();
  if (globalThis._ahdContestsRunning) return;
  globalThis._ahdContestsRunning = true;
  try {
    const active = await contestRounds(db).countDocuments({
      status: "active",
      kind: { $in: [...CONTEST_KINDS] },
    });
    if (active >= CONTEST_KINDS.length) return;
    const gameState = await db
      .collection<GameState>("gameState")
      .findOne({ _id: "current" } as never, { projection: { currentTurn: 1 } });
    await runContests(db, gameState?.currentTurn ?? 0, now);
  } catch (err) {
    Sentry.captureException(err, { tags: { area: "contests", step: "ensureOpen" } });
    console.error("[contests] opening rounds from the page failed", err);
  } finally {
    globalThis._ahdContestsRunning = false;
  }
}

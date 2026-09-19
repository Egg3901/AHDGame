/**
 * Deterministic synthetic-actor materialization seeder (issue #1993).
 *
 * Shell module: takes a Db, writes sandbox documents, owns the sandbox guard.
 * The pure plan (who the seven actors are) lives in `syntheticActors.ts` /
 * `actorCoverage.ts`; this module is what turns that plan into persisted
 * `users` / `characters` rows plus the minimum connected domain state the
 * seven roles need, so the run manifest can be computed from persisted state
 * after seeding instead of from the intended plan.
 *
 * Safety:
 * - Refuses anything that is not a sandbox world: `gameConfig.simSandbox`
 *   must be true AND the database name must match `ahd_sim_*`. There is no
 *   override flag. Never point this at a live database.
 * - Pure-NPP runs never call this module (runWorld gates on the actor mode),
 *   so a pure run keeps zero characters, zero users, zero synthetic rows.
 *
 * Determinism and idempotency:
 * - Every `_id` derives from `syntheticObjectIdHex(seed, key)`, so the same
 *   seed always yields the same documents and every write is an upsert by
 *   `_id`. Retrying a crashed seed changes nothing.
 * - Timestamps and turn stamps arrive as caller-supplied `now` / `turn` so
 *   tests can pin them; identities never depend on them.
 *
 * Minimum connected domain state (all upserted, all keyed off the plan):
 * - US president: `electedOfficials` president row (the presidential
 *   head-of-government chain resolves through it).
 * - DD finance minister: `cabinetMembers` row whose `positionId` equals
 *   `COUNTRY_CONFIGS.DD.financeMinisterCabinetId` (the key the national-issuer
 *   gate looks up).
 * - State-party member: candidacy plus one self-vote per office against ONE
 *   real persisted `statePartyOrg` (attaching to its live voting elections,
 *   creating only missing offices), so `processCompletedElections` seats
 *   through the representative path.
 * - Fed nominee: one nomination queued into the US `centralBanks` nominations
 *   array through the production route checks, so the turn's chair selection
 *   finds a pool.
 * - Founders: two player-CEO corporations (private unlisted + founding IPO
 *   with placed float from the real issuance math) plus one minimal sector
 *   each, mirroring the NPP spawn shape with a character CEO.
 * - Crisis decider: no pre-turn document (crises spawn during turns); the
 *   seated US president supplies the head-of-state role the decision gate
 *   requires.
 */

import { ObjectId, type Db } from "mongodb";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { ALL_POSITIONS } from "@/lib/statePartyElections";
import { computeIpoIssuance } from "@/lib/corporations/ipoIssuance";
import { CEO_INITIAL_SHARES } from "@/lib/constants/corporations";
import { getCentralBankScope } from "@/lib/centralBank/helpers";
import type { CentralBank } from "@/lib/db/types/centralBank";
import { isNominationWindowOpen } from "@/lib/turn/centralBankChairSelection";
import {
  fnv1aHex,
  syntheticObjectIdHex,
  type ActorPopulationSnapshot,
  type SimActorMode,
  type SyntheticActorRole,
} from "./actorCoverage";
import {
  SIM_ACTOR_USERNAME_PREFIX,
  buildSyntheticActorPlan,
  snapshotActorPopulation,
  type ActorPopulationCounts,
} from "./syntheticActors";
import {
  IPO_PROBE_FLOAT_PCT,
  IPO_PROBE_PRICE_PER_SHARE,
  PRIVATE_PROBE_FOUNDING_CAPITAL,
  PROBE_FOUNDER_CASH,
} from "./actorProbes";

/** Database-name prefix every sandbox sim world uses (`ahd_sim_<seed>`). */
export const SIM_SANDBOX_DB_PREFIX = "ahd_sim_";

/** Fixed probe-world timestamp used when the caller does not supply `now`. */
export const SIM_ACTOR_EPOCH_ISO = "1953-01-01T00:00:00.000Z";

/** Synthetic corporation name prefix, so seeded corps are recognizable. */
export const SIM_CORP_NAME_PREFIX = "Sim ";

/** Plan version stamped onto seeded rows alongside the synthetic run id. */
export const SYNTHETIC_MATERIALIZATION_VERSION = 1;

export interface MaterializeSyntheticActorsOptions {
  seed: string;
  /** Synthetic run id stamped onto characters (provenance, not undo). */
  runId: string;
  /** Current game turn, stamped onto founded corps and elections. */
  turn: number;
  now?: Date;
}

export interface MaterializeSyntheticActorsResult {
  users: number;
  characters: number;
  officials: number;
  cabinetSeats: number;
  statePartyElections: number;
  statePartyCandidates: number;
  statePartyVotes: number;
  corporations: number;
  corporateSectors: number;
  /** 1 when this run queued the synthetic Fed-chair nomination, else 0. */
  fedNominations: number;
}

function objectIdFor(seed: string, key: string): ObjectId {
  return new ObjectId(syntheticObjectIdHex(seed, key));
}

/** Escape every regex metacharacter so a constant prefix can anchor a $regex. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Throw unless the target is a marked sandbox sim database. No overrides. */
export async function assertSandboxDb(db: Db): Promise<void> {
  const name = db.databaseName ?? "";
  if (!name.startsWith(SIM_SANDBOX_DB_PREFIX)) {
    throw new Error(
      `Refusing to seed synthetic actors into database "${name}": not a sandbox sim ` +
        `database (expected prefix "${SIM_SANDBOX_DB_PREFIX}").`
    );
  }
  const config = await db
    .collection<{ _id: string; simSandbox?: boolean }>("gameConfig")
    .findOne({ _id: "default" });
  if (config?.simSandbox !== true) {
    throw new Error(
      `Refusing to seed synthetic actors into database "${name}": gameConfig.simSandbox ` +
        "is not true. Seed only worlds the sim harness marked as sandbox."
    );
  }
}

async function upserts(
  db: Db,
  collection: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  docs: Array<Record<string, any>>
): Promise<number> {
  if (docs.length === 0) return 0;
  const ops = docs.map((doc) => ({
    updateOne: { filter: { _id: doc._id }, update: { $set: doc }, upsert: true },
  }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await db.collection(collection).bulkWrite(ops as any);
  return docs.length;
}

/**
 * Deterministic ticker seed-derivative: "S" plus four uppercase letters mapped
 * from the role's deterministic id hex. Fixed tickers would collide on a
 * re-seed with a different seed in the same db (unique ticker index); fully
 * random tickers would break determinism.
 */
export function syntheticTicker(seed: string, role: SyntheticActorRole): string {
  const hex = syntheticObjectIdHex(seed, `ticker:${role}`);
  const letters = hex
    .split("")
    .map((c) => String.fromCharCode(65 + (parseInt(c, 16) % 26)))
    .join("");
  return `S${letters.slice(0, 4)}`;
}

const ROLE_HOME_STATE: Record<SyntheticActorRole, string> = {
  "us-president": "DC",
  "us-fed-nominee": "NY",
  "us-state-party-member": "CA",
  "us-founder-private": "CA",
  "us-founder-ipo": "NY",
  "crisis-decider": "DC",
  "dd-finance-minister": "BE",
};

/**
 * Deterministic per-seed corporation sequential ids. Fixed ids collided on the
 * unique index when two seeds materialized into the same db, so each seed
 * owns a derived odd/even pair inside a high range real counters never reach.
 * Index 0 is the private corp, 1 the IPO corp.
 */
export function syntheticCorporateSequentialId(seed: string, index: 0 | 1): number {
  const slot = parseInt(fnv1aHex(`${seed}:corp-seq`), 16) % 40_000;
  return 900_001 + slot * 2 + index;
}

/**
 * Refuse to overwrite real documents. Every doc this seeder writes carries
 * `isSynthetic: true`; any pre-existing doc under one of our deterministic
 * `_id`s without that marker is real world state (including a `--clone-mode`
 * live restore) and seeding must fail loudly instead of hijacking it.
 */
async function refuseNonSyntheticCollisions(
  db: Db,
  seed: string,
  planned: Array<{ collection: string; ids: ObjectId[] }>
): Promise<void> {
  for (const { collection, ids } of planned) {
    if (ids.length === 0) continue;
    const existing = await db
      .collection(collection)
      .find({ _id: { $in: ids } })
      .toArray();
    const offending = (existing as Array<Record<string, unknown>>).filter(
      (doc) => doc.isSynthetic !== true
    );
    if (offending.length > 0) {
      const sample = offending
        .slice(0, 3)
        .map((doc) => String(doc._id))
        .join(", ");
      throw new Error(
        `Refusing to seed synthetic actors (seed=${seed}): ${offending.length} ` +
          `non-synthetic document(s) already own _id(s) in "${collection}" ` +
          `(e.g. ${sample}). This looks like real world state, not a fresh sandbox.`
      );
    }
  }
}

/**
 * Refuse ticker/sequentialId collisions with real corporations. Our `_id`s are
 * seed-derived, but tickers and sequential ids live under their own unique
 * indexes, so a same-db second seed (or a live restore in clone-mode) that
 * already owns one of our derived values must fail instead of violating the
 * index or, worse, overwriting the upsert-matched doc.
 */
async function refuseCorporateIndexCollisions(
  db: Db,
  seed: string,
  corps: Array<{ _id: ObjectId; tickerSymbol: string; sequentialId: number }>
): Promise<void> {
  const tickers = corps.map((c) => c.tickerSymbol);
  const seqs = corps.map((c) => c.sequentialId);
  const ownIds = new Set(corps.map((c) => c._id.toHexString()));
  const [tickerHits, seqHits] = await Promise.all([
    db
      .collection("corporations")
      .find({ tickerSymbol: { $in: tickers } })
      .toArray(),
    db
      .collection("corporations")
      .find({ sequentialId: { $in: seqs } })
      .toArray(),
  ]);
  const offending = [...tickerHits, ...seqHits].filter(
    (doc) =>
      !ownIds.has(String((doc as { _id: ObjectId })._id)) &&
      (doc as Record<string, unknown>).isSynthetic !== true
  );
  if (offending.length > 0) {
    const sample = offending
      .slice(0, 3)
      .map((doc) => String((doc as { _id: unknown })._id))
      .join(", ");
    throw new Error(
      `Refusing to seed synthetic actors (seed=${seed}): ${offending.length} ` +
        `non-synthetic corporation(s) already own a seeded ticker/sequentialId ` +
        `(e.g. ${sample}). Use a fresh sandbox db.`
    );
  }
}

/**
 * Materialize the deterministic synthetic population into the sandbox db.
 * Idempotent: safe to retry after a crash, and re-running with the same seed
 * rewrites the same documents.
 */
export async function materializeSyntheticActors(
  db: Db,
  options: MaterializeSyntheticActorsOptions
): Promise<MaterializeSyntheticActorsResult> {
  const { seed, runId } = options;
  const turn = options.turn;
  const now = options.now ?? new Date(SIM_ACTOR_EPOCH_ISO);
  await assertSandboxDb(db);

  const plan = buildSyntheticActorPlan(seed);
  const byRole = new Map(plan.actors.map((a) => [a.role, a]));
  const actor = (role: SyntheticActorRole) => {
    const found = byRole.get(role);
    if (!found) throw new Error(`synthetic plan missing role "${role}"`);
    return found;
  };

  const syntheticMarker = { isSynthetic: true, syntheticRunId: runId };
  const users = plan.actors.map((a) => ({
    _id: new ObjectId(a.userIdHex),
    email: `${a.username}@sim.local`,
    username: a.username,
    displayName: a.displayName,
    // Sandbox-only marker: the empty string is not a usable password
    // (`hasUsablePassword` requires non-empty), so this credential can never
    // authenticate. Never store a lookalike sentinel here: any non-empty
    // string reads as a login method.
    password: "",
    role: "player",
    hasCompletedSetup: true,
    activeCharacterId: new ObjectId(a.characterIdHex),
    createdAt: now,
    updatedAt: now,
    ...syntheticMarker,
  }));

  const characters = plan.actors.map((a) => ({
    _id: new ObjectId(a.characterIdHex),
    userId: new ObjectId(a.userIdHex),
    countryId: a.countryId,
    startingCountryId: a.countryId,
    name: a.displayName,
    homeState: ROLE_HOME_STATE[a.role],
    politicalInfluence: 50,
    favorability: 50,
    infamy: 0,
    cashOnHand: PROBE_FOUNDER_CASH,
    currencyBalances: { personal: { USD: PROBE_FOUNDER_CASH } },
    // The seated executive mirrors the electedOfficials row on the character
    // doc, exactly as a production inauguration does. Without it the crisis
    // role check (`deriveCharacterRoles`, keyed off `currentOffice.type`)
    // sees a private citizen: the US config carries no `isHeadOfState`
    // office type, so the officials row alone cannot resolve headOfState.
    ...(a.role === "us-president" ? { currentOffice: { type: "president" } } : {}),
    createdTurn: turn,
    createdAt: now,
    updatedAt: now,
    ...syntheticMarker,
  }));

  // US president: the presidential HoG chain resolves electedOfficials
  // president rows (see headOfGovernment.ts).
  const president = actor("us-president");
  const officials = [
    {
      _id: objectIdFor(seed, "official:us-president"),
      countryId: "US",
      officeType: "president",
      characterId: new ObjectId(president.characterIdHex),
      characterName: president.displayName,
      isNPP: false,
      electedAt: now,
      createdAt: now,
      updatedAt: now,
      ...syntheticMarker,
    },
  ];

  // DD finance minister: the national-issuer gate looks up cabinetMembers by
  // (countryId, positionId = financeMinisterCabinetId, characterId).
  const ddSeat = COUNTRY_CONFIGS.DD?.financeMinisterCabinetId;
  if (!ddSeat) throw new Error("probe assumption broken: DD has no financeMinisterCabinetId");
  const minister = actor("dd-finance-minister");
  const cabinetSeats = [
    {
      _id: objectIdFor(seed, "cabinet:dd-finance-minister"),
      countryId: "DD",
      positionId: ddSeat,
      characterId: new ObjectId(minister.characterIdHex),
      characterName: minister.displayName,
      appointedByPresidentId: new ObjectId(president.characterIdHex),
      appointedByCharacterId: new ObjectId(president.characterIdHex),
      createdAt: now,
      updatedAt: now,
      ...syntheticMarker,
    },
  ];

  // State-party candidacy against a REAL persisted organization. The resolver
  // (`processCompletedElections`) seats winners by writing the org row keyed
  // `${stateId}_${partyId}`, and the creation pass only opens elections for
  // orgs whose party still exists in `politicalParties` — so a synthetic
  // partyId matches neither and can never seat an office. Read one live org
  // (same party join, US preferred), attach the member's candidacy to its
  // existing voting elections where present, create only the missing offices,
  // and seed one self-vote per election: without `statePartyVotes` rows the
  // tally is empty and every office resolves through the no-candidate branch.
  // No org in the db (bare unit-test worlds) means no seating target: skip
  // rather than fabricate an unresolvable party.
  const member = actor("us-state-party-member");
  const memberCharacterId = new ObjectId(member.characterIdHex);
  const electionWindow = 24;
  const persistedParties = (await db.collection("politicalParties").find({}).toArray()) as Array<{
    countryId?: string;
    sequentialId?: number | string;
  }>;
  const livePartyKeys = new Set(
    persistedParties.map((p) => `${p.countryId ?? "US"}:${String(p.sequentialId)}`)
  );
  const persistedOrgs = (await db
    .collection("statePartyOrg")
    .find({})
    .toArray()) as unknown as Array<{
    _id: string;
    stateId: string;
    partyId: string;
    countryId?: string;
  }>;
  const seatedOrgs = persistedOrgs
    .filter(
      (org) =>
        livePartyKeys.size === 0 || livePartyKeys.has(`${org.countryId ?? "US"}:${org.partyId}`)
    )
    .sort((a, b) => (a._id < b._id ? -1 : a._id > b._id ? 1 : 0));
  const targetOrg =
    seatedOrgs.find((org) => (org.countryId ?? "US") === "US") ?? seatedOrgs[0] ?? null;

  const statePartyElections: Array<Record<string, unknown>> = [];
  const statePartyCandidates: Array<Record<string, unknown>> = [];
  const statePartyVotes: Array<Record<string, unknown>> = [];
  if (targetOrg) {
    const orgCountryId = (targetOrg.countryId ?? "US") as CountryId;
    for (const position of ALL_POSITIONS) {
      const existing = await db.collection("statePartyElections").findOne({
        stateId: targetOrg.stateId,
        partyId: targetOrg.partyId,
        countryId: orgCountryId,
        position,
        status: "voting",
      });
      const electionId =
        (existing?._id as ObjectId | undefined) ??
        objectIdFor(seed, `state-party-election:${position}`);
      if (!existing) {
        statePartyElections.push({
          _id: electionId,
          stateId: targetOrg.stateId,
          partyId: targetOrg.partyId,
          countryId: orgCountryId,
          position,
          status: "voting",
          startTime: now,
          endTime: now,
          startTurn: turn,
          endTurn: turn + electionWindow,
          durationTurns: electionWindow,
          winnerId: null,
          createdAt: now,
          updatedAt: now,
          ...syntheticMarker,
        });
      }
      statePartyCandidates.push({
        _id: objectIdFor(seed, `state-party-candidate:${position}`),
        electionId,
        characterId: memberCharacterId,
        characterName: member.displayName,
        stateId: targetOrg.stateId,
        partyId: targetOrg.partyId,
        countryId: orgCountryId,
        position,
        enteredAt: now,
        status: "active",
        ...syntheticMarker,
      });
      statePartyVotes.push({
        _id: objectIdFor(seed, `state-party-vote:${position}`),
        electionId,
        voterId: memberCharacterId,
        candidateId: memberCharacterId,
        votedAt: now,
        ...syntheticMarker,
      });
    }
  }

  // Player-founded corporations: mirror the NPP spawn document shape with a
  // character CEO, so corporationTurn sees structurally complete corps. The
  // private corp stays unlisted at every checkpoint; the IPO corp places a
  // deterministic float through the real issuance math.
  const ipo = computeIpoIssuance({
    existingShares: CEO_INITIAL_SHARES,
    pricePerShare: IPO_PROBE_PRICE_PER_SHARE,
    floatPct: IPO_PROBE_FLOAT_PCT,
  });
  const corpCommon = {
    countryId: "US",
    headquartersState: "DC",
    liquidCurrencyCode: "USD",
    marketingBudget: 0,
    marketingStrength: 10,
    logisticsBudget: 0,
    logisticsStrength: 0,
    rdBudget: 0,
    rdScore: 0,
    ceoSalary: 0,
    brandColor: "#3b82f6",
    dividendRate: 5,
    suspended: false,
    hiddenFromExchange: false,
    foundedAtTurn: turn,
    createdAt: now,
    updatedAt: now,
  };
  const privateFounder = actor("us-founder-private");
  const ipoFounder = actor("us-founder-ipo");
  const corporations = [
    {
      _id: objectIdFor(seed, "corp:private"),
      name: `${SIM_CORP_NAME_PREFIX}Private (${seed})`,
      tickerSymbol: syntheticTicker(seed, "us-founder-private"),
      type: "technology",
      ceoId: new ObjectId(privateFounder.characterIdHex),
      ceoType: "character",
      ceoVacant: false,
      userId: new ObjectId(privateFounder.userIdHex),
      liquidCapital: PRIVATE_PROBE_FOUNDING_CAPITAL,
      sequentialId: syntheticCorporateSequentialId(seed, 0),
      totalShares: CEO_INITIAL_SHARES,
      sharePrice: 0,
      shareholders: [
        { characterId: new ObjectId(privateFounder.characterIdHex), shares: CEO_INITIAL_SHARES },
      ],
      isPrivate: true,
      ...corpCommon,
      ...syntheticMarker,
    },
    {
      _id: objectIdFor(seed, "corp:ipo"),
      name: `${SIM_CORP_NAME_PREFIX}IPO (${seed})`,
      tickerSymbol: syntheticTicker(seed, "us-founder-ipo"),
      type: "technology",
      ceoId: new ObjectId(ipoFounder.characterIdHex),
      ceoType: "character",
      ceoVacant: false,
      userId: new ObjectId(ipoFounder.userIdHex),
      liquidCapital: PRIVATE_PROBE_FOUNDING_CAPITAL + ipo.proceeds,
      sequentialId: syntheticCorporateSequentialId(seed, 1),
      totalShares: ipo.totalSharesAfter,
      sharePrice: IPO_PROBE_PRICE_PER_SHARE,
      shareholders: [
        { characterId: new ObjectId(ipoFounder.characterIdHex), shares: CEO_INITIAL_SHARES },
      ],
      publicFloat: ipo.newShares,
      isPrivate: false,
      ...corpCommon,
      ...syntheticMarker,
    },
  ];
  const corporateSectors = [
    {
      _id: objectIdFor(seed, "corp-sector:private"),
      corporationId: objectIdFor(seed, "corp:private"),
      countryId: "US",
      stateId: "DC",
      sectorType: "technology",
      targetGrowthRate: 3,
      currentGrowthRate: 0,
      currentGrowthCost: 0,
      revenue: 0,
      profitMargin: 0.1,
      workers: 10,
      createdAt: now,
      updatedAt: now,
      ...syntheticMarker,
    },
    {
      _id: objectIdFor(seed, "corp-sector:ipo"),
      corporationId: objectIdFor(seed, "corp:ipo"),
      countryId: "US",
      stateId: "DC",
      sectorType: "technology",
      targetGrowthRate: 3,
      currentGrowthRate: 0,
      currentGrowthCost: 0,
      revenue: 0,
      profitMargin: 0.1,
      workers: 10,
      createdAt: now,
      updatedAt: now,
      ...syntheticMarker,
    },
  ];

  const idOf = (doc: { _id: ObjectId }): ObjectId => doc._id;
  // Refuse before writing anything: a deterministic _id (or corp index value)
  // owned by a real document means this is not a fresh sandbox.
  await refuseNonSyntheticCollisions(db, seed, [
    { collection: "users", ids: users.map(idOf) },
    { collection: "characters", ids: characters.map(idOf) },
    { collection: "electedOfficials", ids: officials.map(idOf) },
    { collection: "cabinetMembers", ids: cabinetSeats.map(idOf) },
    {
      collection: "statePartyElections",
      ids: statePartyElections.map((d) => d._id as ObjectId),
    },
    {
      collection: "statePartyCandidates",
      ids: statePartyCandidates.map((d) => d._id as ObjectId),
    },
    {
      collection: "statePartyVotes",
      ids: statePartyVotes.map((d) => d._id as ObjectId),
    },
    { collection: "corporations", ids: corporations.map(idOf) },
    { collection: "corporateSectors", ids: corporateSectors.map(idOf) },
  ]);
  await refuseCorporateIndexCollisions(
    db,
    seed,
    corporations.map((c) => ({
      _id: c._id,
      tickerSymbol: c.tickerSymbol,
      sequentialId: c.sequentialId,
    }))
  );

  const [
    userCount,
    characterCount,
    officialCount,
    cabinetCount,
    electionCount,
    candidateCount,
    voteCount,
    corpCount,
    sectorCount,
  ] = await Promise.all([
    upserts(db, "users", users),
    upserts(db, "characters", characters),
    upserts(db, "electedOfficials", officials),
    upserts(db, "cabinetMembers", cabinetSeats),
    upserts(db, "statePartyElections", statePartyElections),
    upserts(db, "statePartyCandidates", statePartyCandidates),
    upserts(db, "statePartyVotes", statePartyVotes),
    upserts(db, "corporations", corporations),
    upserts(db, "corporateSectors", corporateSectors),
  ]);

  // Queue the synthetic Fed-chair nomination through the same checks the
  // production nominate route enforces, so the turn's `selectChairCandidate`
  // finds a nomination pool instead of logging a permanent vacancy. The
  // per-turn driver (`driveSyntheticActors`) performs the best-effort accept
  // once the turn seats the nominee as pending.
  const fedNominations = await queueSyntheticFedNomination(db, {
    seed,
    turn,
    now,
    nominator: president,
    nominee: actor("us-fed-nominee"),
  });

  return {
    users: userCount,
    characters: characterCount,
    officials: officialCount,
    cabinetSeats: cabinetCount,
    statePartyElections: electionCount,
    statePartyCandidates: candidateCount,
    statePartyVotes: voteCount,
    corporations: corpCount,
    corporateSectors: sectorCount,
    fedNominations,
  };
}

/**
 * Mirror of the production nominate-route gate
 * (`src/app/api/country/[code]/central-bank/nominate/route.ts`) for the
 * synthetic US pair: the seated synthetic executive nominates the synthetic
 * nominee. Returns 1 when a nomination was queued, 0 when the bank is absent,
 * the nominee is already queued, or any route check fails (window closed,
 * pool full, target ineligible). Idempotent: re-running with the same seed
 * finds the existing nomination and queues nothing.
 */
async function queueSyntheticFedNomination(
  db: Db,
  args: {
    seed: string;
    turn: number;
    now: Date;
    nominator: { characterIdHex: string; displayName: string };
    nominee: { characterIdHex: string; displayName: string };
  }
): Promise<number> {
  const { turn, now, nominator, nominee } = args;
  const { bankId, memberCountries } = await getCentralBankScope(db, "US");
  const bank = await db.collection<CentralBank>("centralBanks").findOne({ _id: bankId });
  if (!bank) return 0;
  const nomineeId = new ObjectId(nominee.characterIdHex);
  const nominations = (bank.nominations ?? []) as Array<{
    characterId: ObjectId;
  }>;
  if (nominations.some((n) => n.characterId?.toString() === nominee.characterIdHex)) return 0;
  // Route checks: window open, at most 3 nominations, target is a player
  // character in a member country who does not hold the executive office.
  if (!isNominationWindowOpen(bank, turn)) return 0;
  if (nominations.length >= 3) return 0;
  const target = await db.collection("characters").findOne({ _id: nomineeId });
  if (!target?.userId) return 0;
  if (!memberCountries.includes((target.countryId ?? "US") as CountryId)) return 0;
  const execOffice = COUNTRY_CONFIGS.US?.officeTypes.find((o) => o.isExecutive);
  const targetOfficeType = (target.currentOffice as { type?: string } | undefined)?.type;
  if (execOffice && targetOfficeType === execOffice.key) return 0;
  await db.collection("centralBanks").bulkWrite([
    {
      updateOne: {
        filter: { _id: bankId },
        update: {
          $set: {
            nominations: [
              ...nominations,
              {
                characterId: nomineeId,
                characterName: nominee.displayName,
                nominatedBy: new ObjectId(nominator.characterIdHex),
                nominatedByName: nominator.displayName,
                nominatedAt: now,
              },
            ],
          },
        },
        upsert: false,
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ] as any);
  return 1;
}

/**
 * Read the persisted actor population back from the sandbox db. runWorld calls
 * this AFTER seeding and builds the manifest from the result, so the manifest
 * reports what is actually in the world, not what the plan intended.
 *
 * Turn-derived evidence counters (candidacies, decided crisis interactions,
 * wealth-list rows, player-founded corps) are live counts: zero on a freshly
 * seeded world before the first turn, populated as turns resolve. A manifest
 * stamped pre-turn honestly shows the seeded population with zero turn
 * evidence; reports must not read coverage from the population alone.
 */
export async function readActorPopulation(
  db: Db,
  args: { mode: SimActorMode; preset: string }
): Promise<ActorPopulationSnapshot> {
  const simUsernamePrefix = escapeRegExp(SIM_ACTOR_USERNAME_PREFIX);
  const [characters, users, syntheticCharacters, syntheticUsers] = await Promise.all([
    db.collection("characters").countDocuments({}),
    db.collection("users").countDocuments({}),
    db.collection("characters").countDocuments({ isSynthetic: true }),
    db.collection("users").countDocuments({ username: { $regex: `^${simUsernamePrefix}` } }),
  ]);
  const syntheticIds = await db
    .collection("characters")
    .find({ isSynthetic: true }, { projection: { _id: 1 } })
    .toArray();
  const syntheticIdSet = syntheticIds.map((d) => d._id);
  const [statePartyCandidates, crisisDecidedInteractions, wealthListRows, playerFoundedCorps] =
    await Promise.all([
      db.collection("statePartyCandidates").countDocuments({}),
      db
        .collection("crisisInteractions")
        .countDocuments({ resolutionPath: { $exists: true, $ne: [] } }),
      db.collection("wealthListHistory").countDocuments({}),
      syntheticIdSet.length > 0
        ? db
            .collection("corporations")
            .countDocuments({ ceoType: "character", ceoId: { $in: syntheticIdSet } })
        : Promise.resolve(0),
    ]);
  const counts: ActorPopulationCounts = {
    mode: args.mode,
    preset: args.preset,
    characters,
    users,
    syntheticCharacters,
    syntheticUsers,
    statePartyCandidates,
    crisisDecidedInteractions,
    wealthListRows,
    playerFoundedCorps,
  };
  return snapshotActorPopulation(counts);
}

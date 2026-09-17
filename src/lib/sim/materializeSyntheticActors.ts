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
 * - State-party member: one `statePartyCandidates` row per ALL_POSITIONS plus
 *   the matching `statePartyElections` rows they stand in.
 * - Founders: two player-CEO corporations (private unlisted + founding IPO
 *   with placed float from the real issuance math) plus one minimal sector
 *   each, mirroring the NPP spawn shape with a character CEO.
 * - Crisis decider: no pre-turn document (crises spawn during turns); the
 *   seated US president supplies the head-of-state role the decision gate
 *   requires.
 */

import { ObjectId, type Db } from "mongodb";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import { ALL_POSITIONS } from "@/lib/statePartyElections";
import { computeIpoIssuance } from "@/lib/corporations/ipoIssuance";
import { CEO_INITIAL_SHARES } from "@/lib/constants/corporations";
import {
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
  corporations: number;
  corporateSectors: number;
}

function objectIdFor(seed: string, key: string): ObjectId {
  return new ObjectId(syntheticObjectIdHex(seed, key));
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
  const config = await db.collection("gameConfig").findOne({ _id: "default" });
  if ((config as { simSandbox?: boolean } | null)?.simSandbox !== true) {
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

  const users = plan.actors.map((a) => ({
    _id: new ObjectId(a.userIdHex),
    email: `${a.username}@sim.local`,
    username: a.username,
    displayName: a.displayName,
    // Sandbox-only marker: this credential is never valid for auth. The value
    // is a sentinel, not a hash, so it cannot be mistaken for a real login.
    password: "sim-only-disabled",
    role: "player",
    hasCompletedSetup: true,
    activeCharacterId: new ObjectId(a.characterIdHex),
    createdAt: now,
    updatedAt: now,
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
    isSynthetic: true,
    syntheticRunId: runId,
    createdTurn: turn,
    createdAt: now,
    updatedAt: now,
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
      party: null,
      isNPP: false,
      electedAt: now,
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
    },
  ];

  // State-party candidacy: one election plus one candidacy per office, so the
  // turn's state-party phase has real candidates to resolve instead of the
  // universal no-candidate branch.
  const member = actor("us-state-party-member");
  const electionWindow = 24;
  const statePartyElections = ALL_POSITIONS.map((position) => ({
    _id: objectIdFor(seed, `state-party-election:${position}`),
    stateId: "CA",
    partyId: "sim-dem",
    countryId: "US",
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
  }));
  const statePartyCandidates = ALL_POSITIONS.map((position) => ({
    _id: objectIdFor(seed, `state-party-candidate:${position}`),
    electionId: objectIdFor(seed, `state-party-election:${position}`),
    characterId: new ObjectId(member.characterIdHex),
    characterName: member.displayName,
    stateId: "CA",
    partyId: "sim-dem",
    countryId: "US",
    position,
    enteredAt: now,
    status: "active",
  }));

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
      sequentialId: 900001,
      totalShares: CEO_INITIAL_SHARES,
      sharePrice: 0,
      shareholders: [
        { characterId: new ObjectId(privateFounder.characterIdHex), shares: CEO_INITIAL_SHARES },
      ],
      isPrivate: true,
      ...corpCommon,
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
      sequentialId: 900002,
      totalShares: ipo.totalSharesAfter,
      sharePrice: IPO_PROBE_PRICE_PER_SHARE,
      shareholders: [
        { characterId: new ObjectId(ipoFounder.characterIdHex), shares: CEO_INITIAL_SHARES },
      ],
      publicFloat: ipo.newShares,
      isPrivate: false,
      ...corpCommon,
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
    },
  ];

  const [
    userCount,
    characterCount,
    officialCount,
    cabinetCount,
    electionCount,
    candidateCount,
    corpCount,
    sectorCount,
  ] = await Promise.all([
    upserts(db, "users", users),
    upserts(db, "characters", characters),
    upserts(db, "electedOfficials", officials),
    upserts(db, "cabinetMembers", cabinetSeats),
    upserts(db, "statePartyElections", statePartyElections),
    upserts(db, "statePartyCandidates", statePartyCandidates),
    upserts(db, "corporations", corporations),
    upserts(db, "corporateSectors", corporateSectors),
  ]);
  return {
    users: userCount,
    characters: characterCount,
    officials: officialCount,
    cabinetSeats: cabinetCount,
    statePartyElections: electionCount,
    statePartyCandidates: candidateCount,
    corporations: corpCount,
    corporateSectors: sectorCount,
  };
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
  const simUsernamePrefix = SIM_ACTOR_USERNAME_PREFIX.replace(/\./g, "\\.");
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

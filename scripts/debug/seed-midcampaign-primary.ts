/**
 * Seed an ACTIVE, MID-CAMPAIGN US presidential primary in the local testing DB,
 * so the Blend primary screen can be looked at with real data.
 *
 * WHAT IT MAKES
 *  - One `president` election for the next cycle, with turn bounds that put the
 *    current turn inside the primary phase.
 *  - A contested field in both US parties. The signed-in player's own character
 *    is filed in the Democratic primary so "your standing" renders.
 *  - A vote tally with the first two stagger waves already run (Iowa, then New
 *    Hampshire), their delegates awarded per state, so the delegate race shows
 *    locked results plus a projection for everything still to vote.
 *  - A campaign per candidate, so "Open campaign manager" leads somewhere.
 *
 * WHY THE TURN BOUNDS ARE WHAT THEY ARE
 *  `computeElectionPhase` is turn-first: `inPrimary` needs
 *  `startTurn <= currentTurn < primaryEndTurn <= endTurn`. The 1953 preset uses
 *  the STRETCHED calendar, whose waves fire at 40/32/24/16/8/0 turns remaining.
 *  Setting `primaryEndTurn = currentTurn + 28` leaves 28 turns, so the waves at
 *  40 and 32 have passed, the next (24) is four turns out, and the race reads as
 *  genuinely mid-campaign rather than either freshly opened or nearly done.
 *
 * DRY RUN BY DEFAULT. Pass `--apply` to write. `--reset` removes a previously
 * seeded race first so the script is repeatable.
 *
 * Local testing DB only: it reads MONGODB_URI, never MONGODB_URI_LIVE.
 */
import { MongoClient, ObjectId, type Db } from "mongodb";
import { config } from "dotenv";
import {
  PRIMARY_WAVES_STRETCHED,
  getDelegatesForState,
  resolvePartyFamily,
} from "@/lib/constants/primaryCalendar";
import { DEFAULT_DURATIONS } from "@/lib/constants/electionDurations";

config({ path: ".env.local" });

const APPLY = process.argv.includes("--apply");
const RESET = process.argv.includes("--reset");

/** Marks every document this script creates, so --reset can find them again. */
const SEED_TAG = "blend-midcampaign-primary";

/** Turns of primary left at the current turn. See the header for why 28. */
const TURNS_LEFT_IN_PRIMARY = 28;
/**
 * Turns from the primary closing to the general resolving.
 *
 * Read from `DEFAULT_DURATIONS` rather than guessed. A real spawn sets
 * `primaryEndTurn = endTurn - generalDurationHours` in `canonicalCycle.ts`, so
 * a seeded race that picks its own number describes a general no other race
 * has. This was hardcoded at 12, which is a quarter of the real length.
 */
const GENERAL_LENGTH_TURNS = DEFAULT_DURATIONS.president.generalDurationHours;
/** Stagger waves already run: Iowa, then New Hampshire. */
const WAVES_RUN = 2;

/** Candidate fields per party. The player's character is spliced into the first. */
const FIELD: Record<string, { count: number; influence: number[]; favorability: number[] }> = {
  "1": { count: 4, influence: [72, 58, 41, 26], favorability: [63, 57, 52, 47] },
  "2": { count: 4, influence: [68, 61, 44, 29], favorability: [61, 58, 51, 46] },
};

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI not set");
  if (/directConnection|MONGODB_URI_LIVE/.test(String(process.argv.join(" ")))) {
    throw new Error("This script only targets the local testing DB.");
  }
  const client = new MongoClient(uri);
  await client.connect();
  const db: Db = client.db(process.env.MONGODB_DB || undefined);
  console.log(`db: ${db.databaseName}  mode: ${APPLY ? "APPLY" : "DRY RUN"}`);

  const gs = await db.collection("gameState").findOne({});
  const currentTurn = Number(gs?.currentTurn ?? 0);
  const preset = String(gs?.preset ?? "1953-default");
  console.log(`currentTurn=${currentTurn} preset=${preset} isActive=${gs?.isActive}`);

  if (RESET) {
    const olds = await db.collection("elections").find({ seedTag: SEED_TAG }).toArray();
    const ids = olds.map((o) => o._id);
    console.log(`reset: removing ${ids.length} previously seeded race(s)`);
    if (APPLY && ids.length > 0) {
      await db.collection("electionCandidates").deleteMany({ electionId: { $in: ids } });
      await db.collection("electionVoteTallies").deleteMany({ electionId: { $in: ids } });
      await db.collection("campaigns").deleteMany({ electionId: { $in: ids } });
      await db.collection("elections").deleteMany({ _id: { $in: ids } });
    }
  }

  const existing = await db.collection("elections").findOne({ seedTag: SEED_TAG });
  if (existing && !RESET) {
    console.log(`already seeded: /elections/${existing._id}  (re-run with --reset to rebuild)`);
    await client.close();
    return;
  }

  // ── Turn bounds ───────────────────────────────────────────────────────────
  const primaryEndTurn = currentTurn + TURNS_LEFT_IN_PRIMARY;
  const endTurn = primaryEndTurn + GENERAL_LENGTH_TURNS;
  const startTurn = currentTurn - 12;
  console.log(`bounds: start=${startTurn} primaryEnd=${primaryEndTurn} end=${endTurn}`);

  const prevCycle = await db
    .collection("elections")
    .find({ electionType: "president", countryId: "US" })
    .sort({ cycle: -1 })
    .limit(1)
    .toArray();
  const cycle = Number(prevCycle[0]?.cycle ?? 0) + 1;
  const electionYear = Number(prevCycle[0]?.electionYear ?? 1953) + 4;

  const now = new Date();
  const electionId = new ObjectId();
  const electionDoc = {
    _id: electionId,
    electionType: "president",
    state: "US",
    countryId: "US",
    seatId: "US-president",
    cycle,
    electionYear,
    status: "active",
    totalSeats: 1,
    startTime: new Date(now.getTime() - 12 * 3_600_000),
    primaryEndTime: new Date(now.getTime() + TURNS_LEFT_IN_PRIMARY * 3_600_000),
    endTime: new Date(now.getTime() + (TURNS_LEFT_IN_PRIMARY + GENERAL_LENGTH_TURNS) * 3_600_000),
    startTurn,
    primaryEndTurn,
    endTurn,
    durationHours: (TURNS_LEFT_IN_PRIMARY + GENERAL_LENGTH_TURNS + 12) * 1,
    primaryDurationHours: (TURNS_LEFT_IN_PRIMARY + 12) * 1,
    rulesetVersion: 3,
    resolving: false,
    seedTag: SEED_TAG,
    createdAt: now,
    updatedAt: now,
  };

  // ── The field ─────────────────────────────────────────────────────────────
  const player = await db.collection("characters").findOne({ countryId: "US" });
  if (!player) throw new Error("no US character to file as the player candidate");

  const parties = await db
    .collection("politicalParties")
    .find({ countryId: "US" })
    .project({ sequentialId: 1, name: 1, economicPosition: 1, primaryCalendar: 1 })
    .toArray();

  const usedNpps = new Set<string>();
  const usedNames = new Set<string>();
  const candidateDocs: Record<string, unknown>[] = [];
  const byParty: Record<string, { id: ObjectId; name: string; isNPP: boolean }[]> = {};

  for (const party of parties) {
    const partyId = String(party.sequentialId);
    const spec = FIELD[partyId];
    if (!spec) continue;
    byParty[partyId] = [];

    // The player leads their own party's field so "your standing" has content.
    const isPlayerParty = String(player.party ?? "") === partyId;
    if (isPlayerParty) {
      const id = new ObjectId();
      candidateDocs.push({
        _id: id,
        electionId,
        countryId: "US",
        characterId: player._id,
        characterName: player.name,
        party: partyId,
        status: "active",
        support: 58,
        enteredAt: now,
        isNPP: false,
        nppId: null,
        primaryCampaignState: player.homeState || null,
        primaryCampaignTicks: 3,
        primarySurgeUsed: false,
        seedTag: SEED_TAG,
      });
      byParty[partyId].push({ id, name: String(player.name), isNPP: false });
    }

    const need = spec.count - (isPlayerParty ? 1 : 0);
    // The NPP pool contains repeated display names, and two candidates sharing a
    // name in one primary is unreadable. Over-fetch and pick distinct names.
    const pool = await db
      .collection("npps")
      .find({ countryId: "US", _id: { $nin: [...usedNpps].map((s) => new ObjectId(s)) } })
      .limit(need * 12)
      .toArray();
    const npps: typeof pool = [];
    for (const npp of pool) {
      if (npps.length >= need) break;
      const name = String(npp.name);
      if (usedNames.has(name)) continue;
      usedNames.add(name);
      npps.push(npp);
    }
    if (npps.length < need) throw new Error("not enough distinctly-named NPPs to fill the field");
    npps.forEach((npp, i) => {
      usedNpps.add(String(npp._id));
      const id = new ObjectId();
      candidateDocs.push({
        _id: id,
        electionId,
        countryId: "US",
        characterId: npp._id,
        characterName: npp.name,
        party: partyId,
        status: "active",
        support: 50 - i * 4,
        enteredAt: now,
        isNPP: true,
        nppId: npp._id,
        primaryCampaignState: null,
        primaryCampaignTicks: 0,
        primarySurgeUsed: false,
        seedTag: SEED_TAG,
      });
      byParty[partyId].push({ id, name: String(npp.name), isNPP: true });
    });
  }

  // ── Awarded delegates for the waves that have already fired ───────────────
  const wavesFired = PRIMARY_WAVES_STRETCHED.slice(0, WAVES_RUN);
  const primaryDelegates: Record<string, Record<string, number>> = {};
  const primaryDelegatesByState: Record<string, Record<string, Record<string, number>>> = {};
  const primaryStateVotes: Record<string, Record<string, Record<string, number>>> = {};

  for (const party of parties) {
    const partyId = String(party.sequentialId);
    const field = byParty[partyId];
    if (!field?.length) continue;
    const family = resolvePartyFamily(partyId, {
      primaryCalendar: party.primaryCalendar ?? null,
      economicPosition: party.economicPosition ?? 0,
    });
    primaryDelegates[partyId] = {};
    primaryDelegatesByState[partyId] = {};
    primaryStateVotes[partyId] = {};

    for (const wave of wavesFired) {
      for (const stateId of wave.states) {
        const pool = getDelegatesForState(stateId, family, preset);
        if (pool <= 0) continue;
        // Front-loaded split so the board has a clear leader and a real chase.
        const weights = field.map((_, i) => Math.max(1, 10 - i * 3));
        const totalW = weights.reduce((a, b) => a + b, 0);
        const byCandidate: Record<string, number> = {};
        const votes: Record<string, number> = {};
        let handed = 0;
        field.forEach((c, i) => {
          const share =
            i === field.length - 1 ? pool - handed : Math.round((weights[i] / totalW) * pool);
          handed += share;
          byCandidate[String(c.id)] = Math.max(0, share);
          votes[String(c.id)] = Math.max(0, share) * 1200 + 400;
        });
        primaryDelegatesByState[partyId][stateId] = byCandidate;
        primaryStateVotes[partyId][stateId] = votes;
        for (const [cid, n] of Object.entries(byCandidate)) {
          primaryDelegates[partyId][cid] = (primaryDelegates[partyId][cid] ?? 0) + n;
        }
      }
    }
  }

  const tallyDoc = {
    _id: new ObjectId(),
    electionId,
    state: "US",
    totalVotes: {},
    candidateNames: Object.fromEntries(
      candidateDocs.map((c) => [String(c._id), String(c.characterName)])
    ),
    candidateParties: Object.fromEntries(
      candidateDocs.map((c) => [String(c._id), String(c.party)])
    ),
    turnSnapshots: [],
    finalized: false,
    primaryStateVotes,
    primaryDelegates,
    primaryDelegatesByState,
    primaryAllocationByState: {},
    primaryWaveHistory: wavesFired.map((w, i) => ({
      wave: i,
      turnsRemaining: w.turnsRemaining,
      statesVoted: w.states,
      recordedAt: now,
    })),
    primaryStaggerWavesRun: WAVES_RUN,
    seedTag: SEED_TAG,
    createdAt: now,
    updatedAt: now,
  };

  // ── Report ────────────────────────────────────────────────────────────────
  console.log(`\nelection: cycle ${cycle}, ${electionYear}, /elections/${electionId}`);
  for (const party of parties) {
    const partyId = String(party.sequentialId);
    const field = byParty[partyId];
    if (!field?.length) continue;
    console.log(`\n${party.name} (${field.length} filed)`);
    for (const c of field) {
      console.log(
        `   ${c.name}${c.isNPP ? "" : "  <- player"}  delegates=${primaryDelegates[partyId]?.[String(c.id)] ?? 0}`
      );
    }
  }
  console.log(
    `\nwaves run: ${WAVES_RUN} (${wavesFired.map((w) => w.label).join(", ")}), next wave in ${
      TURNS_LEFT_IN_PRIMARY - PRIMARY_WAVES_STRETCHED[WAVES_RUN].turnsRemaining
    } turns`
  );

  if (!APPLY) {
    console.log("\nDRY RUN — nothing written. Re-run with --apply.");
    await client.close();
    return;
  }

  await db.collection("elections").insertOne(electionDoc);
  await db.collection("electionCandidates").insertMany(candidateDocs);
  await db.collection("electionVoteTallies").insertOne(tallyDoc);

  // Campaigns, so the campaign manager has somewhere to go.
  const { createInitialCampaign } = await import("@/lib/campaigns/createInitialCampaign");
  for (const c of candidateDocs) {
    await createInitialCampaign({
      db,
      electionId,
      candidateId: c.characterId as ObjectId,
      candidateIsNPP: Boolean(c.isNPP),
      party: String(c.party),
      now,
    });
  }
  await db.collection("campaigns").updateMany({ electionId }, { $set: { seedTag: SEED_TAG } });

  console.log(`\nWROTE. Open: /elections/${electionId}`);
  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

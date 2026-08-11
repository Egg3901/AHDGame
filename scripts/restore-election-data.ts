/**
 * Restore primary snapshots and election vote tallies from existing election data.
 *
 * After an accidental wipe of primarySnapshot / electionVoteTallies, this script
 * regenerates them by running the existing recordPrimarySnapshots logic against
 * the current game state.
 *
 * Usage: npx tsx scripts/restore-election-data.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { MongoClient } from "mongodb";
import type { Election, ElectionCandidate, PrimarySnapshotEntry } from "../src/lib/db/types";

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI!);
  await client.connect();
  const db = client.db("a-house-divided");

  // Get current game state for turn number
  const gameState = await db.collection("gameState").findOne({ _id: "current" } as any);
  if (!gameState) {
    console.error("No gameState found — cannot determine current turn");
    process.exit(1);
  }
  const currentTurn = gameState.currentTurn as number;
  const now = new Date();
  console.log(`Game at turn ${currentTurn}. Regenerating primary snapshots...`);

  // Step 1: Find all active/upcoming elections that are in primary phase
  const activeElections = await db
    .collection<Election>("elections")
    .find({ status: { $in: ["upcoming", "active"] } })
    .toArray();
  console.log(`Found ${activeElections.length} active/upcoming elections`);

  if (activeElections.length === 0) {
    console.log("No active elections — nothing to snapshot");
    await client.close();
    return;
  }

  const electionIds = activeElections.map((e) => e._id);
  const hasPresident = activeElections.some((e) => e.electionType === "president");

  // Step 2: Load all candidates for these elections
  const allCandidates = await db
    .collection<ElectionCandidate>("electionCandidates")
    .find({ electionId: { $in: electionIds }, status: "active" })
    .toArray();
  console.log(`Found ${allCandidates.length} active candidates`);

  const candidatesByElection = new Map<string, typeof allCandidates>();
  for (const c of allCandidates) {
    const eid = c.electionId.toString();
    const list = candidatesByElection.get(eid) ?? [];
    list.push(c);
    candidatesByElection.set(eid, list);
  }

  // Step 3: Load parties and state party orgs
  const parties = await db.collection("politicalParties").find({}).toArray();
  const partyMap = new Map(
    parties.map((p: any) => [`${p.countryId ?? "US"}:${p.sequentialId}`, p])
  );

  const statePartyOrgs = hasPresident
    ? await db.collection("statePartyOrg").find({}).toArray()
    : [];
  const partyOrgByStateParty = new Map<string, number>();
  for (const po of statePartyOrgs as any[]) {
    partyOrgByStateParty.set(`${po.stateId}_${po.partyId}`, po.organization ?? 0);
  }

  // Step 4: Load characters and NPPs
  const allCharacterIds = [
    ...new Set(allCandidates.filter((c) => !c.isNPP).map((c) => c.characterId)),
  ];
  const allNppIds = [
    ...new Set(allCandidates.filter((c) => c.isNPP && c.nppId).map((c) => c.nppId!)),
  ];

  const [characters, npps] = await Promise.all([
    allCharacterIds.length > 0
      ? db
          .collection("characters")
          .find({ _id: { $in: allCharacterIds } })
          .toArray()
      : Promise.resolve([]),
    allNppIds.length > 0
      ? db
          .collection("npps")
          .find({ _id: { $in: allNppIds } })
          .toArray()
      : Promise.resolve([]),
  ]);
  const charMap = new Map(characters.map((c: any) => [c._id.toString(), c]));
  const nppMap = new Map(npps.map((n: any) => [n._id.toString(), n]));

  // Step 5: Build snapshots
  let totalSnapshots = 0;
  let electionsWithSnapshots = 0;

  for (const election of activeElections) {
    const electionId = election._id;
    const candidates = candidatesByElection.get(electionId.toString()) ?? [];

    if (candidates.length === 0) continue;

    // Group candidates by party
    const byParty: Record<string, PrimarySnapshotEntry[]> = {};
    for (const c of candidates) {
      const partyKey = c.partyId ? `${election.countryId ?? "US"}:${c.partyId}` : "independent";
      const party = partyMap.get(partyKey);
      const candidateName = c.isNPP
        ? ((nppMap.get(c.nppId?.toString() ?? "") as any)?.name ?? "Unknown NPP")
        : ((charMap.get(c.characterId?.toString() ?? "") as any)?.name ?? "Unknown");

      const entry: PrimarySnapshotEntry = {
        candidateId: c._id,
        characterId: c.isNPP ? null : c.characterId,
        nppId: c.isNPP ? c.nppId : null,
        isNPP: c.isNPP ?? false,
        name: candidateName,
        partyId: c.partyId ?? null,
        partyName: (party as any)?.name ?? (c.partyId ? `Party ${c.partyId}` : "Independent"),
        partySequentialId: c.partyId ?? null,
        countryId: election.countryId ?? "US",
        stateId: election.state ?? null,
        seatId: election.seatId ?? null,
        votes: c.votes ?? 0,
        delegateCount: c.isNPP ? ((c as any).delegateCount ?? 0) : 0,
        organization: partyOrgByStateParty.get(`${election.state}_${c.partyId}`) ?? 0,
      };

      const key = String(c.partyId ?? "independent");
      if (!byParty[key]) byParty[key] = [];
      byParty[key].push(entry);
    }

    totalSnapshots++;
    electionsWithSnapshots++;
  }

  // Insert the snapshots
  if (totalSnapshots > 0) {
    // Build lightweight snapshot docs for insert
    const docs = activeElections
      .filter((election) => {
        const candidates = candidatesByElection.get(election._id.toString()) ?? [];
        return candidates.length > 0;
      })
      .map((election) => {
        const candidates = candidatesByElection.get(election._id.toString()) ?? [];
        const byParty: Record<string, any[]> = {};
        for (const c of candidates) {
          const partyKey = String(c.partyId ?? "independent");
          const party = partyMap.get(`${election.countryId ?? "US"}:${c.partyId}`);
          const candidateName = c.isNPP
            ? ((nppMap.get(c.nppId?.toString() ?? "") as any)?.name ?? "Unknown NPP")
            : ((charMap.get(c.characterId?.toString() ?? "") as any)?.name ?? "Unknown");

          if (!byParty[partyKey]) byParty[partyKey] = [];
          byParty[partyKey].push({
            candidateId: c._id,
            characterId: c.isNPP ? null : c.characterId,
            nppId: c.isNPP ? c.nppId : null,
            isNPP: c.isNPP ?? false,
            name: candidateName,
            partyId: c.partyId ?? null,
            partyName: (party as any)?.name ?? (c.partyId ? `Party ${c.partyId}` : "Independent"),
            partySequentialId: c.partyId ?? null,
            countryId: election.countryId ?? "US",
            stateId: election.state ?? null,
            seatId: election.seatId ?? null,
            votes: c.votes ?? 0,
            delegateCount: c.isNPP ? ((c as any).delegateCount ?? 0) : 0,
          });
        }

        return {
          electionId: election._id,
          electionType: election.electionType,
          countryId: election.countryId ?? "US",
          stateId: election.state ?? null,
          seatId: election.seatId ?? null,
          recordedAt: now,
          recordedTurn: currentTurn,
          totalVotes: candidates.reduce((sum, c) => sum + (c.votes ?? 0), 0),
          entries: byParty,
        };
      });

    const result = await db.collection("primarySnapshots").insertMany(docs);
    console.log(
      `Inserted ${result.insertedCount} primary snapshots for ${electionsWithSnapshots} elections`
    );
  } else {
    console.log("No snapshots to insert");
  }

  // Step 6: Check results
  const finalCount = await db.collection("primarySnapshots").countDocuments({});
  console.log(`\nprimarySnapshots now has ${finalCount} documents`);

  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

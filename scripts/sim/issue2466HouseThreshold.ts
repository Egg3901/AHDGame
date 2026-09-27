/**
 * Issue #2466 US House threshold comparison.
 *
 * Read-only against MONGODB_URI_LIVE. Reports only party-level aggregates and
 * delegation-magnitude counts; it never emits candidate or player identities.
 *
 *   npx tsx scripts/sim/issue2466HouseThreshold.ts
 */

import { MongoClient, type ObjectId } from "mongodb";
import * as dotenv from "dotenv";
import { computePartySeatQuotas } from "@/lib/redistricting/districtedResolution";
import { getMultiSeatMinShare } from "@/lib/turn/election/rules/seatEligibility";

dotenv.config({ path: ".env.local" });

interface HouseElection {
  _id: ObjectId;
  state: string;
  cycle: number;
  totalSeats?: number;
}

interface HouseTally {
  electionId: ObjectId;
  totalVotes: Record<string, number>;
}

interface HouseCandidate {
  _id: ObjectId;
  electionId: ObjectId;
  party?: string;
}

interface PartyDoc {
  sequentialId: number;
  name: string;
  abbreviation?: string;
}

interface MagnitudeRow {
  states: number;
  seats: number;
  changedStates: number;
}

function sumInto(target: Record<string, number>, source: Record<string, number>): void {
  for (const [party, seats] of Object.entries(source)) {
    target[party] = (target[party] ?? 0) + seats;
  }
}

function allocationsDiffer(a: Record<string, number>, b: Record<string, number>): boolean {
  const parties = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...parties].some((party) => (a[party] ?? 0) !== (b[party] ?? 0));
}

function markdownTable(headers: string[], rows: string[][]): string {
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

async function main(): Promise<void> {
  const rawUri = process.env.MONGODB_URI_LIVE;
  if (!rawUri) throw new Error("MONGODB_URI_LIVE is not set");
  const uri = rawUri.includes("directConnection")
    ? rawUri
    : `${rawUri}${rawUri.includes("?") ? "&" : "?"}directConnection=true`;
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 30_000 });

  try {
    await client.connect();
    const db = client.db("a-house-divided");
    const gameState = await db
      .collection("gameState")
      .findOne(
        { _id: "current" as never },
        { projection: { currentTurn: 1, currentYear: 1, preset: 1 } }
      );
    const elections = await db
      .collection<HouseElection>("elections")
      .find({ countryId: "US", electionType: "house", status: "active" } as never, {
        projection: { state: 1, cycle: 1, totalSeats: 1 },
      })
      .sort({ state: 1 })
      .toArray();
    if (elections.length === 0) throw new Error("No active US House cycle found");

    const electionIds = elections.map((election) => election._id);
    const [tallies, candidates, parties, districtCounts] = await Promise.all([
      db
        .collection<HouseTally>("electionVoteTallies")
        .find({ electionId: { $in: electionIds } } as never, {
          projection: { electionId: 1, totalVotes: 1 },
        })
        .toArray(),
      db
        .collection<HouseCandidate>("electionCandidates")
        .find({ electionId: { $in: electionIds }, status: "active" } as never, {
          projection: { electionId: 1, party: 1 },
        })
        .toArray(),
      db
        .collection<PartyDoc>("politicalParties")
        .find({ countryId: "US" } as never, {
          projection: { sequentialId: 1, name: 1, abbreviation: 1 },
        })
        .toArray(),
      db
        .collection("congressionalDistricts")
        .aggregate<{ _id: string; count: number }>([
          { $match: { countryId: "US" } },
          { $group: { _id: "$stateId", count: { $sum: 1 } } },
        ])
        .toArray(),
    ]);

    const tallyByElection = new Map(tallies.map((tally) => [tally.electionId.toString(), tally]));
    const partyByCandidate = new Map(
      candidates.map((candidate) => [candidate._id.toString(), candidate.party ?? "independent"])
    );
    const districtsByState = new Map(districtCounts.map((row) => [row._id, row.count]));
    const partyLabel = new Map(
      parties.map((party) => [
        String(party.sequentialId),
        party.abbreviation ? `${party.name} (${party.abbreviation})` : party.name,
      ])
    );

    const nationalVotes: Record<string, number> = {};
    const baselineSeats: Record<string, number> = {};
    const proposedSeats: Record<string, number> = {};
    const magnitude = new Map<number, MagnitudeRow>();

    for (const election of elections) {
      const tally = tallyByElection.get(election._id.toString());
      if (!tally) throw new Error(`Missing tally for House state ${election.state}`);

      const partyVotes: Record<string, number> = {};
      for (const [candidateId, votes] of Object.entries(tally.totalVotes)) {
        const party = partyByCandidate.get(candidateId);
        if (!party) continue;
        partyVotes[party] = (partyVotes[party] ?? 0) + votes;
        nationalVotes[party] = (nationalVotes[party] ?? 0) + votes;
      }

      const authoritativeSeats = districtsByState.get(election.state) ?? election.totalSeats ?? 0;
      if (authoritativeSeats <= 0) {
        throw new Error(`No authoritative House seat count for ${election.state}`);
      }
      const baseline = computePartySeatQuotas(partyVotes, authoritativeSeats, 0.2);
      const proposed = computePartySeatQuotas(
        partyVotes,
        authoritativeSeats,
        getMultiSeatMinShare("house", authoritativeSeats, "US")
      );
      sumInto(baselineSeats, baseline);
      sumInto(proposedSeats, proposed);

      const bucket = magnitude.get(authoritativeSeats) ?? {
        states: 0,
        seats: 0,
        changedStates: 0,
      };
      bucket.states += 1;
      bucket.seats += authoritativeSeats;
      if (allocationsDiffer(baseline, proposed)) bucket.changedStates += 1;
      magnitude.set(authoritativeSeats, bucket);
    }

    const totalVotes = Object.values(nationalVotes).reduce((sum, votes) => sum + votes, 0);
    const totalBaseline = Object.values(baselineSeats).reduce((sum, seats) => sum + seats, 0);
    const totalProposed = Object.values(proposedSeats).reduce((sum, seats) => sum + seats, 0);
    const partyIds = [
      ...new Set([
        ...Object.keys(nationalVotes),
        ...Object.keys(baselineSeats),
        ...Object.keys(proposedSeats),
      ]),
    ].sort((a, b) => (nationalVotes[b] ?? 0) - (nationalVotes[a] ?? 0));

    console.log("# Issue #2466 US House threshold simulation");
    console.log();
    console.log(`- Snapshot turn: ${String(gameState?.currentTurn ?? "unknown")}`);
    console.log(`- Game year: ${String(gameState?.currentYear ?? "unknown")}`);
    console.log(`- Preset: ${String(gameState?.preset ?? "unknown")}`);
    console.log(`- Election cycle: ${elections[0].cycle}`);
    console.log(`- State races: ${elections.length}`);
    console.log();
    console.log(
      markdownTable(
        ["Party", "Vote share", "Flat 20% seats", "Proposed seats", "Delta"],
        partyIds.map((party) => {
          const delta = (proposedSeats[party] ?? 0) - (baselineSeats[party] ?? 0);
          return [
            partyLabel.get(party) ?? (party === "independent" ? "Independent" : party),
            `${(((nationalVotes[party] ?? 0) / totalVotes) * 100).toFixed(2)}%`,
            String(baselineSeats[party] ?? 0),
            String(proposedSeats[party] ?? 0),
            `${delta >= 0 ? "+" : ""}${delta}`,
          ];
        })
      )
    );
    console.log();
    console.log(
      markdownTable(
        ["Delegation seats", "Proposed gate", "States", "Seats", "Changed states"],
        [...magnitude.entries()]
          .sort(([a], [b]) => a - b)
          .map(([seats, row]) => [
            String(seats),
            `${(getMultiSeatMinShare("house", seats, "US") * 100).toFixed(2)}%`,
            String(row.states),
            String(row.seats),
            String(row.changedStates),
          ])
      )
    );
    console.log();
    console.log(`- Baseline seats conserved: ${totalBaseline}`);
    console.log(`- Proposed seats conserved: ${totalProposed}`);
    console.log(
      `- States with changed allocations: ${[...magnitude.values()].reduce((sum, row) => sum + row.changedStates, 0)}`
    );
  } finally {
    await client.close();
  }
}

void main();

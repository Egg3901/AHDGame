/**
 * Insert the missing national recap for the resolved 1977 UK Commons snap
 * election. The article is derived from finalized regional tallies and the
 * preceding 1975 Commons result. Existing pages are always preserved.
 *
 * Usage:
 *   npx tsx scripts/migrations/2026-10-01-seed-1977-uk-snap-election-recap.ts --live
 *   npx tsx scripts/migrations/2026-10-01-seed-1977-uk-snap-election-recap.ts --live --apply
 *
 * The default target is MONGODB_URI. Pass --live to select MONGODB_URI_LIVE.
 * Nothing is written unless --apply is present.
 */
import path from "node:path";
import dotenv from "dotenv";
import { MongoClient, ObjectId, type Db } from "mongodb";
import type { Election, ElectionVoteTally, PoliticalParty, State, WikiPage } from "@/lib/db/types";
import type { MigrationResult } from "@/lib/migrations/types";

export const UK_SNAP_RECAP_SLUG = "1977-united-kingdom-house-of-commons-election";
export const UK_SNAP_RECAP_ENTITY_ID = "parl-uk-commons-1977";

const TARGET_YEAR = 1977;
const PRIOR_YEAR = 1975;
const SEED_USER_ID = new ObjectId("000000000000000000000000");
const ENDED_STATUSES = ["completed", "resolved"] as const;

type ElectionRow = Pick<
  Election,
  | "_id"
  | "countryId"
  | "electionType"
  | "state"
  | "cycle"
  | "electionYear"
  | "status"
  | "totalSeats"
  | "endTime"
>;

type TallyRow = Pick<
  ElectionVoteTally,
  "electionId" | "totalVotes" | "candidateParties" | "seatsEstimate" | "finalized"
>;

export interface RecapParty {
  id: string;
  name: string;
  abbreviation: string;
  seats: number;
  votes: number;
}

export interface RecapRegion {
  electionId: string;
  code: string;
  name: string;
  totalSeats: number;
  parties: RecapParty[];
}

export interface NationalElectionRecap {
  year: number;
  electionType: string;
  endedAt: Date;
  totalSeats: number;
  totalVotes: number;
  parties: RecapParty[];
  regions: RecapRegion[];
}

interface PartyIdentity {
  id: string;
  name: string;
  abbreviation: string;
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-GB").format(value);
}

function partyLink(party: PartyIdentity): string {
  return `[${party.name}](/wiki/party/${party.id}?country=uk)`;
}

function partyMap(recap: NationalElectionRecap): Map<string, RecapParty> {
  return new Map(recap.parties.map((party) => [party.id, party]));
}

function allParties(current: NationalElectionRecap, prior: NationalElectionRecap): RecapParty[] {
  const currentById = partyMap(current);
  const priorById = partyMap(prior);
  return [...new Set([...currentById.keys(), ...priorById.keys()])]
    .map((id) => currentById.get(id) ?? priorById.get(id)!)
    .sort((left, right) => {
      const seatDifference =
        (currentById.get(right.id)?.seats ?? 0) - (currentById.get(left.id)?.seats ?? 0);
      if (seatDifference !== 0) return seatDifference;
      return left.abbreviation.localeCompare(right.abbreviation);
    });
}

/** Build factual player-facing Markdown only from certified election data. */
export function buildUkSnapElectionRecapContent(
  current: NationalElectionRecap,
  prior: NationalElectionRecap
): string {
  if (current.year !== TARGET_YEAR || current.electionType !== "snap_commons") {
    throw new Error(`Expected the ${TARGET_YEAR} snap_commons result`);
  }
  if (prior.year !== PRIOR_YEAR) {
    throw new Error(`Expected the ${PRIOR_YEAR} prior result`);
  }
  if (current.totalSeats !== prior.totalSeats) {
    throw new Error("Current and prior Commons seat totals do not match");
  }

  const majority = Math.floor(current.totalSeats / 2) + 1;
  const currentById = partyMap(current);
  const priorById = partyMap(prior);
  const parties = allParties(current, prior);
  const leader = current.parties[0];
  if (!leader || leader.seats <= 0) throw new Error("The snap election has no winning party");

  const governmentKind = leader.seats >= majority ? "majority" : "plurality";
  const shortfall = Math.max(0, majority - leader.seats);
  const regionRows = current.regions.map((region) => {
    const previousRegion = prior.regions.find((candidate) => candidate.code === region.code);
    if (!previousRegion) throw new Error(`Prior result is missing region ${region.code}`);
    const previousById = new Map(previousRegion.parties.map((party) => [party.id, party]));
    const currentRegionById = new Map(region.parties.map((party) => [party.id, party]));
    const split = region.parties
      .filter((party) => party.seats > 0)
      .map((party) => `${party.abbreviation} ${party.seats}`)
      .join(", ");
    const changes = parties
      .map((party) => ({
        abbreviation: party.abbreviation,
        change:
          (currentRegionById.get(party.id)?.seats ?? 0) - (previousById.get(party.id)?.seats ?? 0),
      }))
      .filter(({ change }) => change !== 0)
      .map(({ abbreviation, change }) => `${abbreviation} ${signed(change)}`)
      .join(", ");
    return `| [${region.name}](/wiki/elections/${region.electionId}) (${region.code}) | ${region.totalSeats} | ${split} | ${changes || "No change"} |`;
  });

  const partyMetrics = parties.map((party) => {
    const currentSeats = currentById.get(party.id)?.seats ?? 0;
    const priorSeats = priorById.get(party.id)?.seats ?? 0;
    return `| ${party.abbreviation} seats | ${currentSeats} (${signed(currentSeats - priorSeats)}) |`;
  });
  const changes = parties
    .map((party) => {
      const currentSeats = currentById.get(party.id)?.seats ?? 0;
      const priorSeats = priorById.get(party.id)?.seats ?? 0;
      return `${partyLink(party)}: ${currentSeats} seats (${signed(currentSeats - priorSeats)})`;
    })
    .join("; ");

  const leaderSummary =
    shortfall === 0
      ? `${partyLink(leader)} won an outright majority with ${leader.seats} seats.`
      : `${partyLink(leader)} won the most seats with ${leader.seats}, finishing ${shortfall} short of the ${majority} needed for a majority.`;

  return [
    "*Auto-generated recap of a concluded election. Figures are the certified result. This article can be edited; edits are preserved and not overwritten by regeneration.*",
    "",
    "## At a glance",
    "",
    "| Metric | Value |",
    "| --- | --- |",
    `| Election | ${TARGET_YEAR} United Kingdom House of Commons snap election |`,
    `| Seats in chamber | ${current.totalSeats} (${majority} for a majority) |`,
    ...partyMetrics,
    `| Certified votes | ${formatNumber(current.totalVotes)} |`,
    `| Government | ${leader.name} (${leader.abbreviation}), ${governmentKind} |`,
    "",
    "## Overview",
    `The ${TARGET_YEAR} United Kingdom House of Commons election was a snap election. ${leaderSummary} All ${current.regions.length} regional contests are resolved and their finalized allocations total ${current.totalSeats} seats.`,
    "",
    "## The Chamber",
    current.parties
      .filter((party) => party.seats > 0)
      .map(
        (party) =>
          `${partyLink(party)} holds ${party.seats} seats from ${formatNumber(party.votes)} certified votes.`
      )
      .join(" "),
    "",
    `## Change from the ${PRIOR_YEAR} election`,
    `Compared with the ${PRIOR_YEAR} House of Commons result, ${changes}.`,
    "",
    "## Results by constituency",
    "",
    "| Constituency | Seats | Split | Change vs prior |",
    "| --- | --- | --- | --- |",
    ...regionRows,
    "",
    `*Certified at ${current.endedAt.toISOString().slice(0, 10)} UTC.*`,
  ].join("\n");
}

function requireSingleCycle(rows: ElectionRow[], label: string): void {
  if (rows.length < 2) throw new Error(`${label} has only ${rows.length} regional election rows`);
  const cycles = new Set(rows.map((row) => row.cycle));
  if (cycles.size !== 1) throw new Error(`${label} spans multiple election cycles`);
  const states = new Set(rows.map((row) => row.state));
  if (states.size !== rows.length) throw new Error(`${label} contains duplicate regions`);
}

function buildNationalRecap(
  rows: ElectionRow[],
  tallies: TallyRow[],
  states: Map<string, string>,
  parties: Map<string, PartyIdentity>
): NationalElectionRecap {
  requireSingleCycle(rows, `${rows[0]?.electionYear ?? "Unknown"} election`);
  const tallyByElection = new Map(tallies.map((tally) => [tally.electionId.toString(), tally]));
  if (tallyByElection.size !== tallies.length) {
    throw new Error(`${rows[0]?.electionYear ?? "Unknown"} election has duplicate vote tallies`);
  }
  const nationalSeats = new Map<string, number>();
  const nationalVotes = new Map<string, number>();
  const endedAt = rows[0]?.endTime;
  const year = rows[0]?.electionYear;
  if (!endedAt || year == null) throw new Error("Election year or end time is missing");
  if (rows.some((row) => row.endTime?.getTime() !== endedAt.getTime())) {
    throw new Error(`${year} regional elections do not share an end time`);
  }

  const regions = rows.map((row) => {
    const tally = tallyByElection.get(row._id.toString());
    if (!tally) throw new Error(`${year} ${row.state} is missing its vote tally`);
    if (!tally.finalized) throw new Error(`${year} ${row.state} vote tally is not finalized`);
    if (!Number.isSafeInteger(row.totalSeats) || (row.totalSeats ?? 0) <= 0) {
      throw new Error(`${year} ${row.state} has an invalid seat total`);
    }

    const seats = new Map<string, number>();
    const votes = new Map<string, number>();
    const candidateParties = tally.candidateParties ?? {};
    for (const [candidateId, seatCount] of Object.entries(tally.seatsEstimate ?? {})) {
      if (!Number.isSafeInteger(seatCount) || seatCount < 0) {
        throw new Error(`${year} ${row.state} has an invalid finalized seat allocation`);
      }
      const partyId = candidateParties[candidateId];
      if (!partyId || !parties.has(partyId)) {
        throw new Error(`${year} ${row.state} has an unknown party in its seat allocation`);
      }
      seats.set(partyId, (seats.get(partyId) ?? 0) + seatCount);
      nationalSeats.set(partyId, (nationalSeats.get(partyId) ?? 0) + seatCount);
    }
    const allocatedSeats = [...seats.values()].reduce((sum, value) => sum + value, 0);
    if (allocatedSeats !== row.totalSeats) {
      throw new Error(
        `${year} ${row.state} allocates ${allocatedSeats} of ${row.totalSeats} seats`
      );
    }

    for (const [candidateId, voteCount] of Object.entries(tally.totalVotes ?? {})) {
      if (!Number.isSafeInteger(voteCount) || voteCount < 0) {
        throw new Error(`${year} ${row.state} has an invalid certified vote total`);
      }
      const partyId = candidateParties[candidateId];
      if (!partyId || !parties.has(partyId)) {
        throw new Error(`${year} ${row.state} has an unknown party in its vote totals`);
      }
      votes.set(partyId, (votes.get(partyId) ?? 0) + voteCount);
      nationalVotes.set(partyId, (nationalVotes.get(partyId) ?? 0) + voteCount);
    }

    const regionPartyIds = new Set([...seats.keys(), ...votes.keys()]);
    const regionParties = [...regionPartyIds]
      .map((id) => ({
        ...parties.get(id)!,
        seats: seats.get(id) ?? 0,
        votes: votes.get(id) ?? 0,
      }))
      .sort((left, right) => right.seats - left.seats || right.votes - left.votes);

    return {
      electionId: row._id.toString(),
      code: row.state,
      name: states.get(row.state) ?? row.state,
      totalSeats: row.totalSeats,
      parties: regionParties,
    };
  });

  const nationalPartyIds = new Set([...nationalSeats.keys(), ...nationalVotes.keys()]);
  const nationalParties = [...nationalPartyIds]
    .map((id) => ({
      ...parties.get(id)!,
      seats: nationalSeats.get(id) ?? 0,
      votes: nationalVotes.get(id) ?? 0,
    }))
    .sort((left, right) => right.seats - left.seats || right.votes - left.votes);

  return {
    year,
    electionType: rows[0]!.electionType,
    endedAt,
    totalSeats: rows.reduce((sum, row) => sum + (row.totalSeats ?? 0), 0),
    totalVotes: [...nationalVotes.values()].reduce((sum, value) => sum + value, 0),
    parties: nationalParties,
    regions: regions.sort((left, right) => left.code.localeCompare(right.code)),
  };
}

async function loadElectionRows(
  db: Db,
  electionType: string,
  electionYear: number
): Promise<ElectionRow[]> {
  return db
    .collection<Election>("elections")
    .find(
      {
        countryId: "UK",
        electionType,
        electionYear,
        status: { $in: [...ENDED_STATUSES] },
      },
      {
        projection: {
          countryId: 1,
          electionType: 1,
          state: 1,
          cycle: 1,
          electionYear: 1,
          status: 1,
          totalSeats: 1,
          endTime: 1,
        },
      }
    )
    .toArray() as Promise<ElectionRow[]>;
}

export async function runSeed1977UkSnapElectionRecap(
  db: Db,
  opts: { dryRun?: boolean; now?: Date } = {}
): Promise<MigrationResult> {
  const wikiPages = db.collection<WikiPage>("wikiPages");
  const existing = await wikiPages.findOne(
    {
      $or: [
        { slug: UK_SNAP_RECAP_SLUG },
        { "autoGenerateConfig.entityId": UK_SNAP_RECAP_ENTITY_ID },
      ],
    },
    { projection: { slug: 1, status: 1, private: 1, content: 1, editHistory: 1 } }
  );
  if (existing) {
    return {
      documentsScanned: 1,
      documentsInserted: 0,
      notes: [
        `Existing recap preserved unchanged: slug=${existing.slug}, ` +
          `status=${existing.status ?? "unset"}, private=${existing.private === true}, ` +
          `contentChars=${existing.content?.length ?? 0}.`,
      ],
    };
  }

  const [currentRows, priorRows] = await Promise.all([
    loadElectionRows(db, "snap_commons", TARGET_YEAR),
    loadElectionRows(db, "commons", PRIOR_YEAR),
  ]);
  requireSingleCycle(currentRows, `${TARGET_YEAR} snap election`);
  requireSingleCycle(priorRows, `${PRIOR_YEAR} election`);

  const electionIds = [...currentRows, ...priorRows].map((row) => row._id);
  const regionIds = [...new Set([...currentRows, ...priorRows].map((row) => row.state))];
  const [tallies, stateRows, partyRows] = await Promise.all([
    db
      .collection<ElectionVoteTally>("electionVoteTallies")
      .find(
        { electionId: { $in: electionIds } },
        {
          projection: {
            electionId: 1,
            totalVotes: 1,
            candidateParties: 1,
            seatsEstimate: 1,
            finalized: 1,
          },
        }
      )
      .toArray() as Promise<TallyRow[]>,
    db
      .collection<State>("states")
      .find({ countryId: "UK", _id: { $in: regionIds } }, { projection: { name: 1 } })
      .toArray(),
    db
      .collection<PoliticalParty>("politicalParties")
      .find({ countryId: "UK" }, { projection: { sequentialId: 1, name: 1, abbreviation: 1 } })
      .toArray(),
  ]);

  const states = new Map(stateRows.map((state) => [state._id, state.name]));
  const parties = new Map(
    partyRows.map((party) => [
      String(party.sequentialId),
      {
        id: String(party.sequentialId),
        name: party.name,
        abbreviation: party.abbreviation,
      },
    ])
  );
  const currentIdSet = new Set(currentRows.map((row) => row._id.toString()));
  const currentTallies = tallies.filter((tally) => currentIdSet.has(tally.electionId.toString()));
  const priorTallies = tallies.filter((tally) => !currentIdSet.has(tally.electionId.toString()));
  const current = buildNationalRecap(currentRows, currentTallies, states, parties);
  const prior = buildNationalRecap(priorRows, priorTallies, states, parties);
  const currentRegions = new Set(current.regions.map((region) => region.code));
  const priorRegions = new Set(prior.regions.map((region) => region.code));
  if (
    currentRegions.size !== priorRegions.size ||
    [...currentRegions].some((region) => !priorRegions.has(region))
  ) {
    throw new Error("Current and prior Commons results cover different regions");
  }

  const content = buildUkSnapElectionRecapContent(current, prior);
  const now = opts.now ?? new Date();
  const page: Omit<WikiPage, "_id"> = {
    slug: UK_SNAP_RECAP_SLUG,
    title: "1977 United Kingdom House of Commons Election",
    description: "Certified recap of the 1977 United Kingdom House of Commons snap election.",
    content,
    status: "published",
    submittedBy: SEED_USER_ID,
    tags: ["elections", "recap", "auto-generated", "parliament", "snap-election", "uk"],
    category: "Elections",
    countryId: "UK",
    isAutoGenerated: true,
    autoGenerateConfig: { type: "election", entityId: UK_SNAP_RECAP_ENTITY_ID },
    private: false,
    viewCount: 0,
    createdAt: now,
    updatedAt: now,
    editHistory: [
      {
        userId: SEED_USER_ID,
        timestamp: now,
        action: "created",
        note: "Backfilled from certified regional results",
      },
    ],
  };

  if (opts.dryRun) {
    return {
      documentsScanned: currentRows.length + priorRows.length + tallies.length + 1,
      documentsInserted: 0,
      notes: [
        `Dry run: would insert ${UK_SNAP_RECAP_SLUG}.`,
        `Validated ${current.regions.length} finalized regions, ${current.totalSeats} seats, and ${formatNumber(current.totalVotes)} certified votes.`,
      ],
    };
  }

  const result = await wikiPages.updateOne(
    { slug: UK_SNAP_RECAP_SLUG },
    { $setOnInsert: page },
    { upsert: true }
  );
  const inserted = result.upsertedCount ?? 0;
  return {
    documentsScanned: currentRows.length + priorRows.length + tallies.length + 1,
    documentsInserted: inserted,
    notes: [
      inserted === 1
        ? `Inserted ${UK_SNAP_RECAP_SLUG} from certified results.`
        : `The recap was created concurrently; preserved it unchanged.`,
    ],
  };
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const useLive = args.has("--live");
  const apply = args.has("--apply");
  const envFileArgument = process.argv.find((argument) => argument.startsWith("--env-file="));
  const envFile = envFileArgument?.slice("--env-file=".length);
  dotenv.config({
    path: envFile ? path.resolve(envFile) : path.resolve(process.cwd(), ".env.local"),
    override: true,
  });

  const uriKey = useLive ? "MONGODB_URI_LIVE" : "MONGODB_URI";
  const uri = process.env[uriKey];
  if (!uri) throw new Error(`${uriKey} is not set`);

  const client = new MongoClient(uri, {
    directConnection: !uri.startsWith("mongodb+srv://"),
  });
  await client.connect();
  try {
    const db = client.db();
    const result = await runSeed1977UkSnapElectionRecap(db, { dryRun: !apply });
    console.log(
      JSON.stringify(
        {
          target: useLive ? "live" : "local",
          database: db.databaseName,
          mode: apply ? "apply" : "dry-run",
          ...result,
        },
        null,
        2
      )
    );
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

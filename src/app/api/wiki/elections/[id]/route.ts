import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/errors";
import { checkWikiDisabled } from "@/lib/api/wikiGuard";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { resolveElectionYear } from "@/lib/utils/formatters";
import { getPrimaryWinnersForElection, type CountryId } from "@/lib/constants/countries";
import type {
  Election,
  ElectionCandidate,
  ElectionVoteTally,
  PrimarySnapshot,
  State,
  PoliticalParty,
} from "@/lib/db/types";

const ELECTION_TYPE_LABELS: Record<string, string> = {
  president: "President",
  governor: "Governor",
  house: "House",
  senate: "Senate",
  stateSenate: "State Senate",
  commons: "House of Commons",
  primeMinister: "Prime Minister",
  regionalCouncil: "Regional Council",
  shugiin: "House of Representatives (Shugiin)",
  sangiin: "House of Councillors (Sangiin)",
  bundestag: "Bundestag",
  landtag: "Landtag",
  chancellor: "Chancellor",
  ministerPresident: "Minister-President",
  dail: "Dáil Éireann",
  seanad: "Seanad Éireann",
  uachtaran: "Uachtarán (President)",
  localCouncil: "Local Council",
  npcDelegate: "NPC Delegate",
  peoplesCongress: "People's Congress",
};

const PRESIDENT_COUNTRY: Record<string, string> = {
  president: "United States",
  uachtaran: "Ireland",
};

// GET /api/wiki/elections/[id] — Returns full election detail including primary and general results for wiki display.
// Auth: public; blocked when wiki is disabled
// Errors: 400, 403, 404
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const blocked = await checkWikiDisabled();
    if (blocked) return blocked;
    const { id } = await params;
    let electionId: ObjectId;
    try {
      electionId = new ObjectId(id);
    } catch {
      return NextResponse.json({ error: "Invalid election ID" }, { status: 400 });
    }

    const db = await getDb();

    const election = await db
      .collection<Election>("elections")
      .findOne({ _id: electionId, status: { $in: ["completed", "resolved"] } });

    if (!election) {
      return NextResponse.json({ error: "Election not found" }, { status: 404 });
    }

    // For completed elections, fetch ALL candidates (active + withdrawn) to show who ran
    const candidates = await db
      .collection<ElectionCandidate>("electionCandidates")
      .find({ electionId })
      .toArray();

    const [state, voteTally, parties] = await Promise.all([
      db
        .collection<State>("states")
        .findOne({ _id: election.state, countryId: election.countryId }),
      db.collection<ElectionVoteTally>("electionVoteTallies").findOne({ electionId }),
      // Filter parties by election's country to avoid cross-country sequential ID collisions
      db
        .collection<PoliticalParty>("politicalParties")
        .find({ countryId: election.countryId ?? "US" })
        .project({ sequentialId: 1, name: 1, color: 1, abbreviation: 1 })
        .toArray(),
    ]);

    // Fetch primary snapshots: full history for trend chart + latest for results fallback
    const [allPrimarySnapshots] = await Promise.all([
      db
        .collection<PrimarySnapshot>("primarySnapshots")
        .find({ electionId }, { sort: { recordedAt: 1 } })
        .limit(48)
        .project<Pick<PrimarySnapshot, "recordedAt" | "byParty">>({ recordedAt: 1, byParty: 1 })
        .toArray(),
    ]);

    const lastPrimarySnapshot =
      voteTally?.primaryResults == null && allPrimarySnapshots.length > 0
        ? allPrimarySnapshots[allPrimarySnapshots.length - 1]
        : null;

    const partyMap = new Map(parties.map((p) => [String(p.sequentialId), p]));

    // Build primary results: prefer stored primaryResults on tally, else last primary snapshot
    let primaryResults: Array<{
      partyId: string;
      partyName: string;
      partyColor: string;
      candidates: {
        characterName: string;
        party: string;
        primaryScore: number;
        sharePct: number;
      }[];
    }> = [];

    if (voteTally?.primaryResults) {
      primaryResults = Object.entries(voteTally.primaryResults.byParty).map(
        ([partyId, entries]) => {
          const party = partyMap.get(partyId);
          return {
            partyId,
            partyName: party?.name ?? partyId,
            partyColor: party?.color ?? "#888888",
            candidates: entries
              .sort((a, b) => b.primaryScore - a.primaryScore)
              .map((e) => ({
                characterName: e.characterName,
                party: e.party,
                primaryScore: e.primaryScore,
                sharePct: e.sharePct,
                won: e.won,
              })),
          };
        }
      );
    } else {
      if (lastPrimarySnapshot) {
        // Snapshots record standings, not outcomes, so the winners have to be
        // derived. This used to hardcode `i === 0`, which showed the 2nd and
        // 3rd nominees of a multi-winner race (UK/JP/DE legislatures,
        // one-party states) as primary losers even though they contested the
        // general.
        const maxAdvancing = getPrimaryWinnersForElection(
          (election.countryId ?? "US") as CountryId,
          election.electionType
        );
        primaryResults = Object.entries(lastPrimarySnapshot.byParty).map(([partyId, entries]) => {
          const party = partyMap.get(partyId);
          const sorted = entries.sort((a, b) => b.primaryScore - a.primaryScore);
          return {
            partyId,
            partyName: party?.name ?? partyId,
            partyColor: party?.color ?? "#888888",
            candidates: sorted.map((e, i) => ({
              characterName: e.characterName,
              party: e.party,
              primaryScore: e.primaryScore,
              sharePct: e.sharePct,
              won: i < maxAdvancing,
            })),
          };
        });
      }
    }

    // Build general results (after) from vote tally
    const generalResults = voteTally
      ? {
          totalVotes: voteTally.totalVotes,
          candidateNames: voteTally.candidateNames,
          candidateParties: voteTally.candidateParties,
          seatsEstimate: voteTally.seatsEstimate ?? undefined,
          finalized: voteTally.finalized,
          turnSnapshots: voteTally.turnSnapshots ?? [],
          electoralVotesByCandidate: voteTally.electoralVotesByCandidate ?? undefined,
          totalVotesByUnit: voteTally.totalVotesByUnit ?? undefined,
          electoralMapData:
            (
              voteTally as unknown as {
                electoralMapData?: Record<
                  string,
                  { color: string; label: string; tooltip: string[] }
                >;
              }
            ).electoralMapData ?? undefined,
          stateVoteData:
            (
              voteTally as unknown as {
                stateVoteData?: Record<
                  string,
                  {
                    votesByCandidate: Record<string, number>;
                    evByCandidate: Record<string, number>;
                  }
                >;
              }
            ).stateVoteData ?? undefined,
          stateVotesOverTime:
            (
              voteTally as unknown as {
                stateVotesOverTime?: Record<
                  string,
                  {
                    turn: number;
                    recordedAt: string;
                    cumulativeVotes: Record<string, number>;
                    sharesPct: Record<string, number>;
                  }[]
                >;
              }
            ).stateVotesOverTime ?? undefined,
          resolutionMode: voteTally.resolutionMode ?? undefined,
          contingentResult: voteTally.contingentResult ?? undefined,
        }
      : null;

    const stateName =
      PRESIDENT_COUNTRY[election.electionType] ?? state?.name ?? election.state ?? "—";
    const typeLabel =
      election.electionType === "senate"
        ? `Senate Class ${election.senateClass ?? "?"}`
        : (ELECTION_TYPE_LABELS[election.electionType] ?? election.electionType);

    const year = resolveElectionYear(election);

    // Build minimal snapshot history for trend chart (characterName + sharePct only)
    const primarySnapshotHistory =
      allPrimarySnapshots.length >= 2
        ? allPrimarySnapshots.map((snap) => ({
            recordedAt: snap.recordedAt.toISOString(),
            byParty: Object.fromEntries(
              Object.entries(snap.byParty).map(([partyId, entries]) => [
                partyId,
                entries.map((e) => ({ characterName: e.characterName, sharePct: e.sharePct })),
              ])
            ),
          }))
        : undefined;

    return NextResponse.json(
      {
        id: election._id.toString(),
        electionType: election.electionType,
        state: election.state,
        stateName,
        senateClass: election.senateClass ?? null,
        cycle: election.cycle,
        totalSeats: election.totalSeats ?? null,
        endTime: election.endTime?.toISOString() ?? null,
        year,
        label: `${year} ${stateName} ${typeLabel}`,
        primaryResults,
        primarySnapshotHistory,
        generalResults,
        candidateCount: candidates.length,
      },
      // cache policy: game-state — election results update during active turns; short CDN TTL
      {
        headers: {
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120, no-transform",
        },
      }
    );
  } catch (error) {
    return handleRouteError(error);
  }
}

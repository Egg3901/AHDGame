import type { Db } from "mongodb";
import type { GameIteration } from "@/lib/db/types/gameState";
import { captureServerGameEvent } from "./serverPosthog";

const ELECTION_TYPES = new Set([
  "president",
  "presidential",
  "house",
  "senate",
  "stateSenate",
  "governor",
  "special_governor",
  "commons",
  "snap_commons",
  "special_commons",
  "primeMinister",
  "holyrood",
  "senedd",
  "regionalCouncil",
  "shugiin",
  "snap_shugiin",
  "sangiin",
  "bundestag",
  "assembleeNationale",
  "cameraDeputati",
  "chamber",
  "congresoDiputados",
  "dail",
  "landAssembly",
  "snap_bundestag",
  "landtag",
  "localCouncil",
  "milletMeclisi",
  "nationalitiesDeputy",
  "npcDelegate",
  "peoplesCongress",
  "republicSupremeSoviet",
  "riksdag",
  "seanad",
  "senat",
  "senato",
  "specialElection",
  "supremeSoviet",
  "supremeSovietDeputy",
  "uachtaran",
  "volkskammerDeputy",
  "presidential_primary",
  "party_leadership",
  "unknown",
]);

function safeElectionType(value: string): string {
  return ELECTION_TYPES.has(value) ? value : "unknown";
}

function percentage(value: number): number {
  return Number.isFinite(value) ? Number(value.toFixed(2)) : 0;
}

/** Aggregate, system-identified election outcomes contain no player identity. */
export async function captureElectionResolved(input: {
  db: Db;
  electionId: string;
  electionType: string;
  phase?: "primary" | "general";
  scope: "national" | "regional";
  candidateCount: number;
  playerCandidateCount: number;
  /** `unknown` is used where the persisted tally has no eligible-voter denominator. */
  turnoutPct: number | "unknown";
  seatsAvailable: number;
  nationId?: string;
  turn: number;
  iteration?: GameIteration | null;
}): Promise<void> {
  await captureServerGameEvent({
    db: input.db,
    event: "election_resolved",
    distinctId: "system:election-outcomes",
    insertId: `election-resolved:${input.electionId}:${input.phase ?? "general"}`,
    turn: input.turn,
    iteration: input.iteration,
    ...(input.nationId ? { nationId: input.nationId } : {}),
    properties: {
      election_id: input.electionId,
      election_type: safeElectionType(input.electionType),
      phase: input.phase ?? "general",
      scope: input.scope,
      candidate_count: Math.max(0, Math.trunc(input.candidateCount)),
      player_candidate_count: Math.max(0, Math.trunc(input.playerCandidateCount)),
      turnout_pct: input.turnoutPct === "unknown" ? "unknown" : percentage(input.turnoutPct),
      seats_available: Math.max(0, Math.trunc(input.seatsAvailable)),
    },
  });
}

/** One server outcome per player winner, identified by the existing opaque account ID. */
export async function captureElectionWon(input: {
  db: Db;
  accountId?: string;
  electionId: string;
  electionType: string;
  partyId: string;
  seatCount: number;
  voteSharePct: number;
  marginPct: number;
  incumbent: boolean;
  winnerOrdinal?: number;
  nationId?: string;
  turn: number;
  iteration?: GameIteration | null;
}): Promise<void> {
  await captureServerGameEvent({
    db: input.db,
    event: "election_won",
    distinctId: input.accountId ?? "system:election-outcomes",
    insertId: `election-won:${input.electionId}:${Math.max(0, Math.trunc(input.winnerOrdinal ?? 0))}`,
    turn: input.turn,
    iteration: input.iteration,
    ...(input.nationId ? { nationId: input.nationId } : {}),
    properties: {
      election_id: input.electionId,
      election_type: safeElectionType(input.electionType),
      party_id: /^[A-Za-z0-9_-]{1,32}$/.test(input.partyId) ? input.partyId : "unknown",
      seat_count: Math.max(0, Math.trunc(input.seatCount)),
      vote_share_pct: percentage(input.voteSharePct),
      margin_pct: percentage(input.marginPct),
      incumbent: input.incumbent,
      outcome_source: "server_resolution",
    },
  });
}

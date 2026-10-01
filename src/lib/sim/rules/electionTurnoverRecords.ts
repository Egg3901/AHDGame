/** Historical outcome records are joined without inventing missing people or resolver paths. */
import type { ActorMix, TurnoverCycle } from "./electionTurnover";

export interface ElectionRecord {
  _id: string;
  countryId: string;
  electionType: string;
  state: string;
  seatId?: string;
  senateClass?: number;
  chamberClass?: number;
  cycle: number;
  totalSeats?: number;
  endTurn?: number;
}
export interface CandidateRecord {
  _id: string;
  electionId: string;
  party: string;
  isNPP?: boolean;
  characterId?: string;
  nppId?: string;
}
export interface TallyRecord {
  electionId: string;
  finalized?: boolean;
  seatsEstimate?: Record<string, number>;
  totalVotes?: Record<string, number>;
  candidateParties?: Record<string, string>;
  resolutionPath?: string;
  resolvedAtTurn?: number;
  resolvedSeatHolders?: {
    identity: string;
    party: string;
    seats: number;
    seatSource: "direct" | "list";
  }[];
  resolvedTotalSeats?: number;
}
export interface SnapshotRecord {
  electionId: string;
  summary?: { projectedWinner?: string | null };
  candidates?: { id: string; party: string; isNPP?: boolean }[];
}

/** Pure record join: no today's office holders, rules or flags reconstruct an old winner. */
export function storedTurnoverCycle(
  election: ElectionRecord,
  tally: TallyRecord | undefined,
  candidates: readonly CandidateRecord[],
  snapshot?: SnapshotRecord
): TurnoverCycle {
  const missing: string[] = [];
  const archived = new Map(candidates.map((candidate) => [String(candidate._id), candidate]));
  const frozen = new Map(snapshot?.candidates?.map((candidate) => [candidate.id, candidate]) ?? []);
  let assigned = tally?.finalized ? tally.seatsEstimate : undefined;
  if (!assigned && election.totalSeats === 1 && snapshot?.summary?.projectedWinner)
    assigned = { [snapshot.summary.projectedWinner]: 1 };
  let seats: Record<string, number> | null = null,
    people: string[] | null = null,
    winningActors: ("player" | "npp")[] | null = null;
  if (
    assigned &&
    Object.values(assigned).every((n) => Number.isSafeInteger(n) && n >= 0) &&
    Object.values(assigned).some((n) => n > 0)
  ) {
    seats = {};
    people = [];
    winningActors = [];
    for (const [id, count] of Object.entries(assigned))
      if (count > 0) {
        const candidate = archived.get(id),
          known = frozen.get(id),
          party = candidate?.party ?? known?.party ?? tally?.candidateParties?.[id];
        if (!party) {
          seats = null;
          missing.push("winning party unavailable");
        } else if (seats) seats[party] = (seats[party] ?? 0) + count;
        const npp = candidate?.isNPP ?? known?.isNPP;
        const person =
          npp === true ? candidate?.nppId : npp === false ? candidate?.characterId : undefined;
        if (person && people) people.push(`${npp ? "npp" : "player"}:${String(person)}`);
        else people = null;
        if (typeof npp === "boolean" && winningActors) winningActors.push(npp ? "npp" : "player");
        else winningActors = null;
      }
    if (
      election.totalSeats &&
      Object.values(assigned).reduce((a, b) => a + b, 0) !== election.totalSeats
    ) {
      seats = null;
      people = null;
      winningActors = null;
      missing.push("stored seats do not match election capacity");
    }
  } else missing.push("final stored allocation unavailable");
  const holders = tally?.finalized ? tally.resolvedSeatHolders : undefined;
  let outcomeScope =
    tally?.resolutionPath === "ams" || tally?.resolutionPath === "ams_direct"
      ? "direct tier only; historical list holders unavailable"
      : "stored candidate allocation; historical composite coverage unknown";
  if (holders) {
    const valid =
      holders.length > 0 &&
      holders.every(
        (holder) =>
          /^(player|npp):.+/.test(holder.identity) &&
          holder.party &&
          Number.isSafeInteger(holder.seats) &&
          holder.seats > 0
      ) &&
      holders.reduce((total, holder) => total + holder.seats, 0) === tally?.resolvedTotalSeats;
    if (valid) {
      seats = {};
      for (const holder of holders) seats[holder.party] = (seats[holder.party] ?? 0) + holder.seats;
      people = [...new Set(holders.map((holder) => holder.identity))];
      winningActors = holders.map((holder) =>
        holder.identity.startsWith("npp:") ? "npp" : "player"
      );
      outcomeScope =
        tally?.resolutionPath === "ams"
          ? "complete direct and list holder receipt"
          : "resolved direct holder receipt";
      missing.splice(0, missing.length);
    } else {
      seats = null;
      people = null;
      winningActors = null;
      missing.push("invalid resolved holder receipt");
    }
  }
  if (!people) missing.push("winner person identity unavailable");
  if (!winningActors) missing.push("winner actor kind unavailable");
  if (!tally?.resolutionPath) missing.push("executed resolver unavailable");
  const fieldIds = Object.keys(tally?.totalVotes ?? assigned ?? {});
  const field = fieldIds.map((id) => archived.get(id)?.isNPP ?? frozen.get(id)?.isNPP);
  const mix: ActorMix =
    !field.length || field.some((value) => typeof value !== "boolean")
      ? "unknown"
      : field.every(Boolean)
        ? "npp-only"
        : field.every((value) => !value)
          ? "player-only"
          : "mixed";
  return {
    id: String(election._id),
    countryId: election.countryId,
    family: election.electionType,
    outcomeScope,
    scope: JSON.stringify([
      outcomeScope,
      election.countryId,
      election.electionType,
      election.state,
      election.seatId ?? null,
      election.senateClass ?? null,
      election.chamberClass ?? null,
    ]),
    cycle: election.cycle,
    resolvedTurn: tally?.resolvedAtTurn ?? null,
    seats,
    people,
    winningActors,
    actorMix: mix,
    resolutionPath: tally?.resolutionPath ?? null,
    missing: [...new Set(missing)],
  };
}

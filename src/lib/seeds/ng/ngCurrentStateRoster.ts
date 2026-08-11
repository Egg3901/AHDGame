import type { HistoricalSeat } from "@/lib/constants/historicalSeats";
import { allocateSeatsByShare } from "./ngSeatAllocation";
import {
  resolveNigeriaPresidentialResult,
  NG_ZONES,
} from "@/lib/nigeriaPresidentialElectionEngine";
import { canonicalTurnsForCycle } from "@/lib/elections/canonicalCycle";

const SLUG = { sdp: "ng_sdp", nrc: "ng_nrc" } as const;

export interface NGRosterInput {
  voteShares: Record<string, Record<string, number>>;
  zonePopulations: Record<string, number>;
  houseSeatsByZone: Record<string, number>;
  senateSeatsByZone: Record<string, number>;
  regionalCouncilSeatsByZone: Record<string, number>;
  cycle: number;
  electionYear: number;
  ctx: { startingYear: number; preset: string };
}

export interface NGRosterResult {
  historicalSeats: HistoricalSeat[];
  senateSeatsHeld: { zone: string; slug: string; seats: number }[];
  presidentSlug: string;
  resolvedElections: Array<{
    electionType: string;
    state: string;
    cycle: number;
    electionYear: number;
    startTurn: number;
    endTurn: number;
    primaryEndTurn: number;
    winningPartySlug: string;
  }>;
}

export function buildNGCurrentRoster(input: NGRosterInput): NGRosterResult {
  const {
    voteShares,
    zonePopulations,
    houseSeatsByZone,
    senateSeatsByZone,
    regionalCouncilSeatsByZone,
    cycle,
    electionYear,
    ctx,
  } = input;

  // President: national winner via the NG spread resolver over voteShare × population.
  const zoneTallies: Record<string, Record<string, number>> = {};
  for (const zone of NG_ZONES) {
    const pop = zonePopulations[zone] ?? 0;
    const s = voteShares[zone] ?? {};
    zoneTallies[zone] = { sdp: (s.sdp ?? 0) * pop, nrc: (s.nrc ?? 0) * pop };
  }
  const presidentResult = resolveNigeriaPresidentialResult(zoneTallies);
  const winnerKey =
    presidentResult.outcome === "won"
      ? presidentResult.winnerPartyId!
      : presidentResult.runoffPartyIds![0];
  const presidentSlug = SLUG[winnerKey as "sdp" | "nrc"];

  const historicalSeats: HistoricalSeat[] = [];
  const senateSeatsHeld: NGRosterResult["senateSeatsHeld"] = [];

  for (const zone of NG_ZONES) {
    const shares = voteShares[zone] ?? {};
    // House — aggregate seatsHeld (computeHouseMap sums it).
    const h = allocateSeatsByShare(houseSeatsByZone[zone] ?? 0, shares);
    for (const key of ["sdp", "nrc"] as const) {
      if ((h[key] ?? 0) > 0)
        historicalSeats.push({
          state: zone,
          officeType: "house",
          party: SLUG[key],
          seatsHeld: h[key],
        });
    }
    // Senate — 2 party officials per zone (seat1/seat2); seatsHeld set post-seed
    // via senateSeatsHeld (seedFromSeats does not persist seatsHeld for "senate").
    const sen = allocateSeatsByShare(senateSeatsByZone[zone] ?? 0, shares);
    for (const key of ["sdp", "nrc"] as const) {
      if ((sen[key] ?? 0) > 0) {
        historicalSeats.push({ state: zone, officeType: "senate", party: SLUG[key] });
        senateSeatsHeld.push({ zone, slug: SLUG[key], seats: sen[key] });
      }
    }
    // State House of Assembly — aggregate seatsHeld (summed like House).
    const rc = allocateSeatsByShare(regionalCouncilSeatsByZone[zone] ?? 0, shares);
    for (const key of ["sdp", "nrc"] as const) {
      if ((rc[key] ?? 0) > 0)
        historicalSeats.push({
          state: zone,
          officeType: "regionalCouncil",
          party: SLUG[key],
          seatsHeld: rc[key],
        });
    }
  }

  // President seat (national).
  historicalSeats.push({ state: "NG", officeType: "president", party: presidentSlug });

  // Resolved elections for the last-completed cycle: president (NG) + house/senate/governor per zone.
  const resolvedElections: NGRosterResult["resolvedElections"] = [];
  const zoneWinner = (zone: string) =>
    (voteShares[zone]?.sdp ?? 0) >= (voteShares[zone]?.nrc ?? 0) ? "ng_sdp" : "ng_nrc";
  const mk = (electionType: string, state: string, winningPartySlug: string) => {
    const t = canonicalTurnsForCycle({ electionType, cycle, countryId: "NG", ctx })!;
    resolvedElections.push({
      electionType,
      state,
      cycle,
      electionYear,
      startTurn: t.startTurn,
      endTurn: t.endTurn,
      primaryEndTurn: t.primaryEndTurn,
      winningPartySlug,
    });
  };
  mk("president", "NG", presidentSlug);
  for (const zone of NG_ZONES) {
    mk("house", zone, zoneWinner(zone));
    mk("senate", zone, zoneWinner(zone));
    mk("governor", zone, zoneWinner(zone));
    mk("regionalCouncil", zone, zoneWinner(zone));
  }

  return { historicalSeats, senateSeatsHeld, presidentSlug, resolvedElections };
}

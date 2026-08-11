import type { ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { TurnPhaseTelemetryMap } from "./turnPhaseTelemetry";

export interface TurnWarning {
  phase: string;
  message: string;
  turn: number;
  timestamp: Date;
}

export interface TurnError {
  phase: string;
  message: string;
  stack?: string;
  turn: number;
  timestamp: Date;
}

export interface IntegrityIssue {
  category: string;
  severity: "warning" | "error";
  message: string;
  documentId?: string;
  collection?: string;
}

export interface DataIntegrityResult {
  lastCheckTurn: number;
  checkCadenceTurns: number;
  orphanedCandidates: number;
  orphanedOfficials: number;
  partiesWithoutMembers: number;
  membersInDeletedParties: number;
  electionsWithoutCandidates: number;
  seatBackedSeatsWithoutOfficials: number;
  issues: IntegrityIssue[];
}

export interface PopulationStats {
  activePlayers: number;
  totalCharacters: number;
  totalNPPs: number;
  emptySeats: number;
  totalSeats: number;
  partiesCount: number;
  activeElections: number;
  averagePartySize: number;
  byCountry: Partial<
    Record<
      CountryId,
      {
        players: number;
        npps: number;
        emptySeats: number;
        parties: number;
      }
    >
  >;
}

export interface EconomyStats {
  byCountry: Partial<
    Record<
      CountryId,
      {
        /**
         * Annualized real GDP GROWTH (%/yr), not a level. Named `gdp` until
         * 2026-07-27, which made every run report look like a collapsing
         * economy: a healthy convergence from 3.8%/yr toward ~2.3% potential
         * reads as "GDP fell from 3.8 to 2.3" when the field is called `gdp`.
         */
        gdpGrowth: number;
        /** Real GDP LEVEL — sum of regional `states.gdp` for the country. */
        gdp: number;
        inflation: number;
        interestRate: number;
        bondDefaultRate: number;
        totalCorporationRevenue: number;
        averagePlayerFunds: number;
        fundCirculation: number;
      }
    >
  >;
}

export interface GameHealthSnapshot {
  _id: ObjectId;
  turn: number;
  year: number;
  timestamp: Date;

  turnProcessing: {
    durationMs: number;
    success: boolean;
    phaseCount: number;
    phasesSkipped: number;
    warningCount: number;
    errorCount: number;
    warnings: TurnWarning[];
    errors: TurnError[];
    phaseStatuses: TurnPhaseTelemetryMap;
  };

  dataIntegrity: DataIntegrityResult | null;

  population: PopulationStats;

  economy: EconomyStats;
}

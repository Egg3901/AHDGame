import { type UnionServiceId } from "@/lib/unions/unionServices";

export interface UnionDetail {
  id: string;
  name: string;
  countryId: string;
  countryName: string;
  sectorType: string;
  sectorLabel: string;
  ownerId: string | null;
  pendingLeaderCharacterId: string | null;
  electionOpen: boolean;
  leadershipElectionMinStrength: number;
  strength: number;
  organizeActionCost: number;
  organizeStrengthGain: number;
  organizeSectorActionCost?: number;
  organizeSectorTreasuryCost?: number;
  treasury: number;
  /** Real headcount: workers across this union's sectors, weighted by unionization. */
  members: number;
  /** 0-100, how the membership rates the bargain. Dues push it down, services push it up. */
  approval: number;
  /** Annual dues charged per member, in the union's home currency. */
  duesPerWorkerAnnual: number;
  /** Service programmes currently switched on. */
  activeServices: UnionServiceId[];
  paidServices?: UnionServiceId[];
  /**
   * Share of remaining per-turn budget sent to organizers as political
   * contributions, 0-0.5. Absent reads as none.
   */
  politicalContributionPct?: number;
  /**
   * Member-weighted average annual wage across this union's sectors, needed to
   * price dues and services against local pay. 0 = not known yet (e.g. before
   * the labour system has written sector wages).
   */
  annualWage: number;
  /** The union's standing public wage claim, or null when it has none. */
  demandedWageLevel: number | null;
  /** True while this union's country bans unions: every action 403s server-side. */
  suspended: boolean;
  /**
   * Illicit-union shadow snapshot, present only while suspended. Exact heat
   * never leaves the server: `heatText` is the vague bracket the UI renders.
   */
  underground: {
    strength: number | null;
    status: "dark" | "suspected" | "exposed" | null;
    heatText: "cold" | "warm" | "hot" | null;
    exposedUntilTurn: number | null;
    actionCost: number;
    quietGain: number;
    massGain: number;
  } | null;
  currentTurn: number;
}

/** Union-wide membership rollup: covered headcount and density over the sectors this union stands in. */
export interface WorkforceSummary {
  totalWorkers: number;
  unionizedWorkers: number;
  /** Fraction 0-1 of the total workforce that is unionized. */
  density: number;
}

export interface VoteTally {
  characterId: string;
  name: string;
  votes: number;
}

export interface CandidateOption {
  characterId: string;
  name: string;
  sequentialId: number | null;
  avatarUrl: string | null;
  /** True when this seat is held by an NPP (`Union.ownerType === "npp"`). */
  isNPP?: boolean;
}

/** One organizer on the roster, with the banked strength that is their vote weight. */
export interface OrganizerRow extends CandidateOption {
  strength: number;
  organizeCount: number;
  influencePct: number;
  isLeader: boolean;
}

export interface SectorRow {
  sectorId: string;
  corporationId: string;
  corporationName: string;
  stateId: string;
  wageLevel: number;
  workers: number;
  wageGap: number | null;
  unionization: number;
  representingUnionId: string | null;
  strikeActive: boolean;
  strikeCooldownUntilTurn: number | null;
  strikeBlockReason:
    "underorganized" | "already_striking" | "sector_cooldown" | "collective_agreement" | null;
}

export interface ActionableBill {
  billId: string;
  billTitle: string;
  status: string;
  stance: "endorse" | "oppose" | null;
}

export interface EndorsementRow {
  billId: string;
  billTitle: string;
  stance: "endorse" | "oppose";
  createdAt: string;
}

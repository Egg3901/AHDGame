import type { ObjectId } from "mongodb";
import type { FactorLedgerSnapshot } from "@/lib/electionEngine/factorLedger";

export interface VoteTurnSnapshot {
  turn: number;
  recordedAt: Date;
  cumulativeVotes: Record<string, number>;
  sharesPct: Record<string, number>;
  /** Multi-seat races only (house, stateSenate, commons, …): Hamilton seat projection at this turn. */
  seatsEstimate?: Record<string, number>;
}

/** Stored when primary resolves — canonical primary results for wiki/history. */
export interface PrimaryResultEntry {
  candidateId: string;
  characterName: string;
  party: string;
  primaryScore: number;
  sharePct: number;
  won: boolean;
}

export interface PrimaryResults {
  byParty: Record<string, PrimaryResultEntry[]>;
  recordedAt: Date;
}

export interface ElectionVoteTally {
  _id: ObjectId;
  electionId: ObjectId;
  state: string;
  totalVotes: Record<string, number>;
  candidateNames: Record<string, string>;
  candidateParties: Record<string, string>;
  turnSnapshots: VoteTurnSnapshot[];
  finalized: boolean;
  seatsEstimate?: Record<string, number>;
  /** Stored when primary resolves; used for wiki election history. */
  primaryResults?: PrimaryResults;
  createdAt: Date;
  updatedAt: Date;

  /** President only: votes per electoral unit (state or ME/NE district). unitId -> candidateId -> votes */
  totalVotesByUnit?: Record<string, Record<string, number>>;
  /** President only: electoral votes per candidate after resolution */
  electoralVotesByCandidate?: Record<string, number>;
  /** President only: how the race was resolved when finalized */
  resolutionMode?: "majority" | "contingent" | "contingent_deadlock";
  /** President only: House/Senate contingent vote breakdown when no EV majority */
  contingentResult?: {
    eligiblePresidentCandidateIds: string[];
    eligibleVicePresidentCandidateIds: string[];
    houseDelegationVotes: Record<string, string | null>;
    houseVoteTotals: Record<string, number>;
    senateVotes: Record<string, string | null>;
    senateVoteTotals: Record<string, number>;
    presidentWinnerId: string;
    vicePresidentWinnerId: string | null;
    houseThreshold: number;
    senateThreshold: number;
    deadlockBreakerUsed?: boolean;
    deadlockBreakerReason?: string;
    topElectoralVoteTotal: number;
  };
  /** President only: per-unit turn snapshots for EV projection */
  unitTurnSnapshots?: Record<string, VoteTurnSnapshot[]>;
  /**
   * President only: the economic-referendum reading the engine applied on the
   * last accumulation turn (see `src/lib/electionEngine/economicReferendum.ts`).
   * Descriptive snapshot for the UI gauge — the shift is already baked into the
   * vote totals and must NOT be applied again anywhere downstream.
   */
  economicReferendum?: {
    miseryIndex: number;
    /** The shift actually applied, after any calibration scale. */
    sharePts: number;
    components: Array<{ key: string; label: string; contributionPts: number }>;
    fatigueMultiplier: number;
    /**
     * Share of the raw penalty forgiven by credit-for-response, in [0, 0.4].
     * Absent when no enacted bill qualified.
     */
    forgivenessFrac?: number;
    /** The bills that earned the forgiveness. */
    creditedBills?: Array<{ key: string; title: string; component: string; weight: number }>;
    incumbentPartyId?: string;
    recordedTurn: number;
  };
  /**
   * President only: the descriptive factor ledger the engine teed on the last
   * accumulation turn (see `src/lib/electionEngine/factorLedger.ts`). A
   * read-only decomposition of each candidate's votes into named factors
   * (state lean & standing, policy fit, name recognition, turnout, persuasion
   * swing, spoiler, national mood, campaign, and a rounding residual). Already
   * baked into the vote totals above — it is teed off them — so, exactly like
   * `economicReferendum`, it must NEVER be re-applied anywhere downstream.
   */
  factorLedger?: FactorLedgerSnapshot;
  /**
   * President only: frozen House/Senate chamber used for contingent ballots.
   * Captured when contingent resolution first runs so same-turn chamber flips
   * cannot change the ballot after down-ballot races resolve.
   */
  contingentChamberSnapshot?: {
    capturedAt: Date;
    houseDelegations: Array<{
      stateId: string;
      voters: Array<{
        id: string;
        party: string;
        economic: number;
        social: number;
        weight?: number;
      }>;
    }>;
    senators: Array<{
      id: string;
      party: string;
      economic: number;
      social: number;
      weight?: number;
    }>;
  };
  /** President only: set when contingent resolution failed and will retry next turn. */
  contingentResolutionPending?: boolean;
  /** President only: tally finalized but executive seating failed; retry seating only. */
  executiveSeatingPending?: boolean;

  /**
   * President-primary-only: per-state intra-party votes accumulated during the final 6 turns.
   * Shape: partyId -> stateId -> candidateId -> votes
   */
  primaryStateVotes?: Record<string, Record<string, Record<string, number>>>;
  /**
   * President-primary-only: delegates awarded per candidate per party after stagger waves.
   * Shape: partyId -> candidateId -> delegates
   */
  primaryDelegates?: Record<string, Record<string, number>>;
  /**
   * President-primary-only: per-state delegates awarded, for historical display.
   * Shape: partyId -> stateId -> candidateId -> delegates
   */
  primaryDelegatesByState?: Record<string, Record<string, Record<string, number>>>;
  /**
   * President-primary-only: allocation method used for each state this cycle.
   * Snapshot frozen at primary start from state party chair choice.
   * Shape: partyId -> stateId -> "PR" | "WTA"
   */
  primaryAllocationByState?: Record<string, Record<string, "PR" | "WTA">>;
  /**
   * President-primary-only: stagger waves that have already run this cycle.
   * Each turn's wave stores `{ wave, turnsRemaining, statesVoted, recordedAt }`.
   */
  primaryWaveHistory?: {
    wave: number;
    turnsRemaining: number;
    statesVoted: string[];
    recordedAt: Date;
  }[];
  /**
   * President-primary-only: authoritative counter of stagger waves that have
   * run this cycle. Maintained atomically via `$inc` alongside the
   * `primaryWaveHistory` `$push`, so runtime control flow is robust against
   * accidental edits to the display history array. Trusted by
   * `runPrimaryStaggerWaveIfDue` when present; falls back to
   * `primaryWaveHistory.length` for legacy tallies without the counter.
   */
  primaryStaggerWavesRun?: number;
  /**
   * President-primary-only: accumulated, decayed expectation-beating momentum
   * points per candidate. A candidate that beats its projected national share in
   * a wave gains points (capped at `primaryMomentumCapPoints`); carried momentum
   * decays by `primaryMomentumDecay` each wave. Persisted only for races on the
   * stretched calendar; at cap 0 every value is 0 and the vote path is
   * unchanged. Distinct from the favorability-bump "momentum" (win/upset fav
   * bonuses applied to characters/npps) — this is the vote-share carry.
   * Shape: partyId -> candidateId -> accumulated decayed momentum points.
   */
  primaryMomentum?: Record<string, Record<string, number>>;
  /**
   * President-primary-only: per-wave momentum snapshot for history/replay. Each
   * entry records the post-decay momentum points for every party's candidates
   * after that wave resolved.
   */
  primaryMomentumByWave?: {
    wave: number;
    byParty: Record<string, Record<string, number>>;
    recordedAt: Date;
  }[];
  /**
   * President-primary-only: how each party's presidential nomination resolved.
   * Written once at primary close for races on a convention-enabled ruleset
   * (v3+). `delegate_majority` means a candidate held a pledged-delegate majority
   * on the first ballot; `convention` records the multi-ballot elimination that
   * released delegates by affinity until a survivor reached a majority of the
   * remaining delegates. Purely descriptive/audit — the nominee is also seated
   * through the normal primaryResults/elimination machinery. Absent on v1/v2
   * races (which keep the silent plurality pick). Shape: partyId -> resolution.
   */
  nominationResolution?: {
    byParty: Record<
      string,
      {
        mode: "delegate_majority" | "convention";
        winnerCandidateId: string;
        majorityThreshold: number;
        firstBallotLeaderId: string;
        ballots?: {
          ballot: number;
          tallies: Record<string, number>;
          eliminatedCandidateId?: string;
        }[];
        resolvedAt: Date;
      }
    >;
  };
  /**
   * President-primary-only: per-state polling trend during the pre-stagger
   * window. Each snapshot captures projected score per candidate per state for
   * each party, so the state-detail page can render a simple trend over time.
   * Capped at the 24 most-recent snapshots to bound document size.
   * Shape: snapshot -> partyId -> stateId -> candidateId -> projected score
   */
  primaryStatePollingHistory?: {
    turn: number;
    recordedAt: Date;
    byParty: Record<string, Record<string, Record<string, number>>>;
  }[];
}

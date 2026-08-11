import type { ObjectId } from "mongodb";

/**
 * Cross-pressure forces driving an NPP's bill vote. All four are scored on a
 * shared -100..+100 axis: positive pulls FOR, negative pulls AGAINST. Stored as
 * a snapshot so the prediction surface (Phase 5) can render exactly the math
 * that produced the resolved vote.
 */
export interface CrossPressureForces {
  /** Policy alignment with the NPP's domain stance × bill direction. */
  ideology: number;
  /** Combined party + caucus whip pull, gated by the NPP's compliance. */
  whip: number;
  /** Population-weighted approval of the selected policy option in the NPP's home state. */
  district: number;
  /** Donor base × NPP stance × bill direction. */
  donors: number;
}

/**
 * Per-(NPP, bill) snapshot of the cross-pressure inputs and the deterministic
 * verdict the resolver produced. Written by `processBillVoting` whenever an NPP
 * is about to vote on (or has just voted on) the bill.
 *
 * `verdict` is the resolver's prediction (computed from `forces`); `resolvedVote`
 * is the value actually written onto the bill. They should always match — any
 * drift indicates a bug in the resolver wiring.
 */
export interface NPPVotePrediction {
  _id: ObjectId;
  nppId: ObjectId;
  /**
   * Federal bill target. Local bill predictions use `stateBillId` instead.
   * Exactly one of `billId` / `stateBillId` should be set.
   */
  billId?: ObjectId;
  /**
   * State / regional bill target. Federal predictions use `billId` instead.
   * Exactly one of `billId` / `stateBillId` should be set.
   */
  stateBillId?: ObjectId;

  /** Game turn when the forces were last recomputed. */
  computedAtTurn: number;

  forces: CrossPressureForces;

  /** Short narrative label for the donors slice — see `narrateDonors` in crossPressure.ts. */
  donorsLabel: string;

  /** Verdict derived from `forces` at compute time (sum > 5 → for, < -5 → against, else abstain). */
  verdict: "for" | "against" | "abstain";

  /** Vote actually written onto the bill. Null until the vote lands. */
  resolvedVote: "for" | "against" | "abstain" | null;

  createdAt: Date;
  updatedAt: Date;
}

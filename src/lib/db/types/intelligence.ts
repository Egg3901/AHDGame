import type { ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";

/** The three domains an operation can work in. Political is deliberately absent. */
export type IntelligenceDomain = "strategic" | "military" | "economic";

/** Did the operation do what it set out to do. */
export type OperationOutcome = "success" | "miss";

/**
 * How badly the operation was compromised. Independent of `OperationOutcome`, so
 * a successful operation can still be attributed — which is the point.
 *
 * Monotonic on attacker cost: each rung carries every cost of the rung below it.
 * `blown` deliberately does NOT erase coverage already collected; compromise costs
 * future ACCESS, never intelligence already in hand.
 */
export type OperationCompromise = "clean" | "blown" | "detected" | "attributed";

export type NetworkFunding = "none" | "trickle" | "steady" | "crash";

export type NetworkStatus = "building" | "active" | "burned" | "dormant";

/**
 * One per country. Holds no money. The service spends `FederalBudget.intelligenceAppropriation`, which
 * survives a reunification merge where this document does not — `mergeCountry` purges the
 * intelligence collections.
 */
export interface IntelligenceAgency {
  _id: ObjectId;
  countryId: CountryId;
  /** The cabinet seat holder, denormalized for reads. Null is the COMMON case. */
  directorCharacterId: ObjectId | null;
  /** Agency-wide capability, 1..10. Moves very slowly. */
  tradecraft: number;
  /** Defensive posture, 0..100. Derived each turn for NPP countries. */
  counterIntel: number;
  /** DiplomaticActionBudget shape: refreshed lazily on read for a newer turn. */
  opSlots: { turn: number; remaining: number };
  foundedTurn: number;
  updatedAt: Date;
}

/** One per (owner, target). This is ACCESS. */
export interface IntelligenceNetwork {
  _id: ObjectId;
  ownerCountryId: CountryId;
  targetCountryId: CountryId;
  level: number;
  progress: number;
  funding: NetworkFunding;
  /**
   * Heat, 0..100. Named to match `covertNuclear`'s existing `suspicion` rather
   * than inventing a second word for the same concept.
   */
  suspicion: number;
  status: NetworkStatus;
  /** A burned network cannot be used until this turn passes. */
  cooledUntilTurn: number | null;
  lastOpTurn: number;
  updatedAt: Date;
}

/**
 * One per (owner, target, domain). This is FRESHNESS.
 *
 * The stored value is the reading AT COLLECTION TIME; the live value is derived
 * on read from `lastCollectedTurn`. Nothing rewrites these rows every turn — the
 * same lazy pattern `DiplomaticActionBudget` uses for its budget.
 */
export interface IntelligenceCoverage {
  _id: ObjectId;
  ownerCountryId: CountryId;
  targetCountryId: CountryId;
  domain: IntelligenceDomain;
  valueAtCollection: number;
  lastCollectedTurn: number;
  updatedAt: Date;
}

/**
 * Append-only, one row per resolved operation.
 *
 * Unlike `CapitalActionLog` this carries the result, because intelligence
 * operations are NOT deterministic. `rollDetail` is for audit and for the
 * simulation reports and is never served to the target.
 */
export interface IntelligenceOpLog {
  _id: ObjectId;
  ownerCountryId: CountryId;
  targetCountryId: CountryId;
  domain: IntelligenceDomain;
  opType: string;
  directorCharacterId: ObjectId | null;
  /** The acting user's id. A string, matching how auth carries it. */
  actorUserId: string | null;
  outcome: OperationOutcome;
  compromise: OperationCompromise;
  rollDetail: {
    networkLevel: number;
    coverage: number;
    tradecraft: number;
    statMultiplier: number;
    counterIntel: number;
    suspicion: number;
    difficulty: number;
    successRoll: number;
    compromiseRoll: number;
  };
  budgetSpent: number;
  slotsSpent: number;
  effectSummary: string;
  turn: number;
  createdAt: Date;
}

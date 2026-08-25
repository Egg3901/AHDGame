import type { ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";

/**
 * UK manifesto model (Cluster A — electoral).
 *
 * A manifesto is a party's set of pledges for a single election. The leader
 * authors it and it LOCKS at election call (dissolution): immutable through the
 * campaign, judged for delivery at the following election.
 *
 * Design of record: ops-knowledge `uk-rework-design-2026-08-25`; epic #856.
 *
 * Nothing here changes live election behaviour on its own — scoring lives in
 * `src/lib/uk/manifesto/manifestoPopularity.ts` and is only consumed once the
 * vote-model multiplier is switched on (behind review + worldsim calibration).
 */

/** How a pledge is judged kept vs broken at the next election. */
export type PledgeTargetSemantics =
  /** Kept iff one of the mapped policy options is the ACTIVE policy at judgment. */
  | "enact"
  /** Kept UNLESS the active policy moved against the pledge (funding cut, stance reversed). */
  | "maintain";

/**
 * A designer-authored headline pledge. Players pick from this catalog rather
 * than free text, so every pledge has a real ideological position (for
 * popularity scoring) and concrete target policy options (for kept/broken).
 */
export interface PledgeCatalogEntry {
  /** Stable catalog id, e.g. "uk.nhs.protect". */
  id: string;
  /** Player-facing headline, e.g. "Protect the NHS". */
  label: string;
  /** Short campaign blurb. */
  blurb?: string;
  /** Grouping for UI + salience (mirrors LegislationType.policyDomain). */
  policyDomain: string;
  /**
   * Real policy options this pledge maps to (legislationTypeId + optionId).
   * Used for the kept/broken check against `enactedLaws`.
   */
  targets: PledgeTarget[];
  /**
   * The pledge's ideological position on the shared -5..+5 axes, scored against
   * each demographic group's mean via `calcAppeal`.
   */
  position: { economic: number; social: number };
  targetSemantics: PledgeTargetSemantics;
  /**
   * How much voters care, keyed by demographic group id (e.g. "age:senior").
   * Regional texture emerges for free because regions have different group mixes.
   * Absent keys fall back to `baseSalience`.
   */
  salienceByGroup?: Record<string, number>;
  /** Default salience where no per-group value is set. 0..1. */
  baseSalience: number;
  /** Country this catalog entry belongs to (UK for now). */
  countryId: CountryId;
  /** Optional era gating (era anchor keys). Omitted = all eras. */
  eras?: string[];
}

export interface PledgeTarget {
  legislationTypeId: string;
  /** The specific option that satisfies the pledge (enact), or the baseline to not fall below (maintain). */
  policyOptionId: string;
}

/** A concrete pledge chosen for a manifesto — a reference into the catalog. */
export interface Pledge {
  catalogEntryId: string;
}

/**
 * One document per party per election.
 * Collection: "manifestos"
 */
export interface Manifesto {
  _id?: ObjectId;
  countryId: CountryId;
  electionId: ObjectId;
  /** Party sequential id / code (matches ElectionCandidate.party). */
  party: string;
  /** Exactly MANIFESTO_PLEDGE_COUNT pledges once locked. */
  pledges: Pledge[];
  /** Author character (the party leader). Null for auto-generated NPP manifestos. */
  authorCharacterId: ObjectId | null;
  /** True for AI-generated manifestos (still judged on delivery). */
  isNPP: boolean;
  /** Set when the election is called; immutable thereafter. */
  lockedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Result of judging a locked manifesto against enacted laws at the next election. */
export interface ManifestoDeliveryResult {
  total: number;
  kept: number;
  broken: number;
  /** kept / total, 0..1. Undefined if total === 0. */
  meter: number;
  perPledge: Array<{ catalogEntryId: string; kept: boolean; reason: string }>;
}

/** Number of pledges a manifesto must contain once locked. */
export const MANIFESTO_PLEDGE_COUNT = 3;

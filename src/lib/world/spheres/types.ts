import type { ObjectId } from "mongodb";
import type { CommodityType } from "@/lib/constants/commodities";
import type { MacroMarketContribution } from "@/lib/world/macro/types";
import type { WorldEntityId } from "@/lib/world/worldEntityManifest";

/** Treaty posture for a sphere relationship — distinct from the treaty id list. */
export type SphereTreatyState = "none" | "proposed" | "active" | "suspended";

/**
 * Runtime relationship record for sphere mechanics.
 * Aligns with {@link WorldEntityRelationship} plus explicit treaty posture.
 */
export interface SphereRelationship {
  sponsorId: WorldEntityId;
  /** 0–1 political/diplomatic alignment with the sponsor. */
  alignment: number;
  /** 0–1 economic/institutional integration with the sponsor. */
  integration: number;
  /** Authored treaty identifiers (Marshall Plan, occupation accords, etc.). */
  treatyIds: string[];
  /** Whether treaty obligations are currently live for flow computation. */
  treatyState: SphereTreatyState;
}

/** Sphere posture for one entity (Austria, etc.). */
export interface SphereMembership {
  entityId: WorldEntityId;
  presetId: string;
  /** Exactly one primary when relationships are non-empty; receives full market benefits. */
  primarySphereId: WorldEntityId | null;
  relationships: readonly SphereRelationship[];
}

/** Configured caps that prevent duplicate full benefits and runaway transfers. */
export interface SphereBounds {
  /**
   * Max fraction of the held macro contribution each secondary relationship
   * may add to the shared market (0 = none). Primary always uses 1.0.
   */
  secondaryMarketShare: number;
  /** Cap on the sum of all secondary market shares for one entity. */
  maxTotalSecondaryMarketShare: number;
  /** Max absolute ₳ aid (sponsor → member) per relationship per turn. */
  maxAidPerTurn: number;
  /** Max absolute ₳ tribute (member → sponsor) per relationship per turn. */
  maxTributePerTurn: number;
  /** Max absolute ₳ support (military/dev) per relationship per turn. */
  maxSupportPerTurn: number;
  /** Cap on |aid|+|tribute|+|support| across all relationships for one entity. */
  maxTotalFlowsPerEntityPerTurn: number;
}

export type SphereFlowKind = "aid" | "tribute" | "support";

/**
 * Sponsor management intents (#3718). Distinct from monetary `support` flows —
 * ledger rows use {@link SphereSponsorLedgerKind} for these.
 */
export type SphereSponsorIntent = "court" | "support" | "retain" | "lose";

/** Who issued a sponsor intent — same apply surface either way. */
export type SphereSponsorController = "npp" | "player";

/** Ledger kinds for sponsor management decisions (auditable alongside flows). */
export type SphereSponsorLedgerKind = "court" | "sponsor_support" | "retain" | "lose";

export type SphereLedgerKind = SphereFlowKind | SphereSponsorLedgerKind;

/** Signed flow: positive amount means the listed direction. */
export interface SphereFlow {
  kind: SphereFlowKind;
  fromEntityId: WorldEntityId;
  toEntityId: WorldEntityId;
  /** Absolute ₳ amount after bounds. */
  amount: number;
  sponsorId: WorldEntityId;
  memberId: WorldEntityId;
  reason: string;
}

/** Result of one court/support/retain/lose application. */
export interface SphereSponsorDecision {
  turn: number;
  sponsorId: WorldEntityId;
  memberId: WorldEntityId;
  intent: SphereSponsorIntent;
  controller: SphereSponsorController;
  alignmentDelta: number;
  integrationDelta: number;
  primaryChanged: boolean;
  previousPrimaryId: WorldEntityId | null;
  nextPrimaryId: WorldEntityId | null;
  reason: string;
}

/** Append-only auditable ledger row for sphere monetary flows and sponsor decisions. */
export interface SphereFlowLedgerEntry {
  _id: ObjectId;
  turn: number;
  createdAt: Date;
  kind: SphereLedgerKind;
  fromEntityId: WorldEntityId;
  toEntityId: WorldEntityId;
  memberId: WorldEntityId;
  sponsorId: WorldEntityId;
  amount: number;
  currencyCode: "USD";
  reason: string;
  boundsApplied: boolean;
  emitSite: string;
  /** Present on sponsor-management rows. */
  controller?: SphereSponsorController;
  alignmentDelta?: number;
  integrationDelta?: number;
}

/** How much of a held contribution is attributed to one sponsor. */
export interface SphereMarketAllocation {
  sponsorId: WorldEntityId;
  isPrimary: boolean;
  /** 0–1 share of the held contribution applied for this sponsor. */
  share: number;
  contribution: MacroMarketContribution;
}

export interface SphereRoutedContribution {
  entityId: WorldEntityId;
  /** Units that hit the shared global market (no duplicate full packages). */
  marketContribution: MacroMarketContribution;
  allocations: SphereMarketAllocation[];
  flows: SphereFlow[];
}

/** Admin/world read-model row explaining one active sphere effect. */
export interface SphereEffectExplanation {
  entityId: WorldEntityId;
  sponsorId: WorldEntityId;
  isPrimary: boolean;
  alignment: number;
  integration: number;
  treatyState: SphereTreatyState;
  treatyIds: string[];
  marketShare: number;
  marketCommodityCount: number;
  flows: Array<{ kind: SphereFlowKind; amount: number; direction: string; reason: string }>;
  bounds: {
    secondaryMarketShare: number;
    maxAidPerTurn: number;
    maxTributePerTurn: number;
    maxSupportPerTurn: number;
    maxTotalFlowsPerEntityPerTurn: number;
  };
  summary: string;
}

export type CommodityBalanceMap = Map<CommodityType, { supply: number; demand: number }>;

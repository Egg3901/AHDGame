import type { Db } from "mongodb";
import type { SentimentPulse } from "@/lib/db/types/sentimentPulse";

const COLLECTION = "sentimentPulses";

async function insertPulse(db: Db, pulse: Omit<SentimentPulse, "_id">): Promise<void> {
  await db.collection(COLLECTION).insertOne(pulse as SentimentPulse);
}

/** Bond default: corp-scoped, −15%, fast decay */
export async function fireBondDefaultPulse(db: Db, corpId: string): Promise<void> {
  await insertPulse(db, {
    scope: "corp",
    corpId,
    initialImpact: -0.15,
    decayRate: 0.78,
    createdAt: new Date(),
    eventType: "bond_default",
  });
}

/** IMF bailout triggered: corp-scoped, −20%, fastest decay */
export async function fireImfBailoutPulse(db: Db, corpId: string): Promise<void> {
  await insertPulse(db, {
    scope: "corp",
    corpId,
    initialImpact: -0.2,
    decayRate: 0.75,
    createdAt: new Date(),
    eventType: "imf_bailout",
  });
}

/**
 * Subsidy created: sector-scoped, positive pulse.
 * `magnitude` should be between 0.08 and 0.15 depending on subsidy tier.
 * Default 0.10 if unknown.
 */
export async function fireSubsidyCreatedPulse(
  db: Db,
  sectorType: string,
  countryId: string,
  magnitude = 0.1
): Promise<void> {
  await insertPulse(db, {
    scope: "sector",
    sectorType,
    countryId,
    initialImpact: Math.min(0.15, Math.max(0.08, magnitude)),
    decayRate: 0.85,
    createdAt: new Date(),
    eventType: "subsidy_created",
  });
}

/**
 * Subsidy ended: sector-scoped, negative pulse.
 * Mirror of subsidy_created.
 */
export async function fireSubsidyEndedPulse(
  db: Db,
  sectorType: string,
  countryId: string,
  magnitude = 0.1
): Promise<void> {
  await insertPulse(db, {
    scope: "sector",
    sectorType,
    countryId,
    initialImpact: -Math.min(0.15, Math.max(0.08, magnitude)),
    decayRate: 0.85,
    createdAt: new Date(),
    eventType: "subsidy_ended",
  });
}

/**
 * Tariff passed: sector-scoped pulse. Sign depends on whether the tariff
 * helps domestic corps (+) or hurts foreign corps operating in the country (−).
 * Caller computes the sign and passes a positive `magnitude`.
 */
export async function fireTariffPulse(
  db: Db,
  sectorType: string,
  countryId: string,
  impact: number, // signed, caller determines +/−
  hqRelation?: "domestic" | "foreign"
): Promise<void> {
  const clamped = Math.max(-0.12, Math.min(0.12, impact));
  await insertPulse(db, {
    scope: "sector",
    sectorType,
    countryId,
    hqRelation,
    initialImpact: clamped,
    decayRate: 0.82,
    createdAt: new Date(),
    eventType: "tariff_passed",
  });
}

/**
 * v3 Phase 6: strike begins — sector-scoped, negative pulse (disruption).
 */
export async function fireStrikeStartedPulse(
  db: Db,
  sectorType: string,
  countryId: string
): Promise<void> {
  await insertPulse(db, {
    scope: "sector",
    sectorType,
    countryId,
    initialImpact: -0.1,
    decayRate: 0.8,
    createdAt: new Date(),
    eventType: "strike_started",
  });
}

/**
 * v3 Phase 6: strike resolved (concession or wait-it-out) — sector-scoped,
 * mild positive pulse (relief that the disruption ended). Both resolution
 * paths fire this same pulse; the distinction matters for game state
 * (unionization/cooldown), not for the sentiment signal.
 */
export async function fireStrikeResolvedPulse(
  db: Db,
  sectorType: string,
  countryId: string
): Promise<void> {
  await insertPulse(db, {
    scope: "sector",
    sectorType,
    countryId,
    initialImpact: 0.04,
    decayRate: 0.85,
    createdAt: new Date(),
    eventType: "strike_resolved",
  });
}

/**
 * v3 Phase 7a: a union-busting attempt succeeded — sector-scoped, mild
 * negative pulse (quiet suppression, still visible but less damaging than a
 * public backfire).
 */
export async function fireUnionBustingSuccessPulse(
  db: Db,
  sectorType: string,
  countryId: string
): Promise<void> {
  await insertPulse(db, {
    scope: "sector",
    sectorType,
    countryId,
    initialImpact: -0.06,
    decayRate: 0.85,
    createdAt: new Date(),
    eventType: "union_busting_success",
  });
}

/**
 * v3 Phase 7a: a union-busting attempt backfired — sector-scoped, larger
 * negative pulse than a success (a failed, publicly visible union-busting
 * attempt is worse PR than a quiet successful one).
 */
export async function fireUnionBustingBackfirePulse(
  db: Db,
  sectorType: string,
  countryId: string
): Promise<void> {
  await insertPulse(db, {
    scope: "sector",
    sectorType,
    countryId,
    initialImpact: -0.14,
    decayRate: 0.8,
    createdAt: new Date(),
    eventType: "union_busting_backfire",
  });
}

/**
 * Legislation with sector margin effects: sector-scoped pulse.
 * `marginalImpact` is the bill's signed margin modifier (e.g., +0.03 = +3pp margin).
 * Scales to a sentiment pulse: 1pp margin ≈ +2.5% sentiment.
 */
export async function fireLegislationPulse(
  db: Db,
  sectorType: string,
  countryId: string,
  marginalImpact: number // signed decimal from bill provision (e.g. 0.03)
): Promise<void> {
  const sentiment = Math.max(-0.2, Math.min(0.2, marginalImpact * 2.5));
  if (Math.abs(sentiment) < 0.005) return; // too small to bother
  await insertPulse(db, {
    scope: "sector",
    sectorType,
    countryId,
    initialImpact: sentiment,
    decayRate: 0.8,
    createdAt: new Date(),
    eventType: "legislation",
  });
}

import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import type {
  SphereFlow,
  SphereFlowLedgerEntry,
  SphereSponsorDecision,
  SphereSponsorIntent,
  SphereSponsorLedgerKind,
} from "./types";

export const SPHERE_FLOW_LEDGER_COLLECTION = "sphereFlowLedger";

function sponsorIntentToLedgerKind(intent: SphereSponsorIntent): SphereSponsorLedgerKind {
  if (intent === "support") return "sponsor_support";
  return intent;
}

/**
 * Append auditable sphere flow rows (aid / tribute / support).
 * Follows the nationalizationLedger pattern: append-only, best-effort, never
 * throws to the caller — sphere accounting must not abort market turns.
 */
export async function recordSphereFlowLedger(
  db: Db,
  turn: number,
  flows: readonly SphereFlow[],
  emitSite = "world/spheres/ledger.ts"
): Promise<SphereFlowLedgerEntry[]> {
  if (flows.length === 0) return [];

  const createdAt = new Date();
  const docs: SphereFlowLedgerEntry[] = flows.map((flow) => ({
    _id: new ObjectId(),
    turn,
    createdAt,
    kind: flow.kind,
    fromEntityId: flow.fromEntityId,
    toEntityId: flow.toEntityId,
    memberId: flow.memberId,
    sponsorId: flow.sponsorId,
    amount: flow.amount,
    currencyCode: "USD",
    reason: flow.reason,
    boundsApplied: true,
    emitSite,
  }));

  try {
    await db.collection<SphereFlowLedgerEntry>(SPHERE_FLOW_LEDGER_COLLECTION).insertMany(docs, {
      ordered: false,
    });
  } catch {
    // Shadow-style: market turn continues; ops can inspect Sentry/logs elsewhere.
  }

  return docs;
}

/**
 * Append sponsor management decisions to the same ledger collection so court /
 * support / retain / lose actions are auditable alongside monetary flows.
 */
export async function recordSphereSponsorDecisions(
  db: Db,
  decisions: readonly SphereSponsorDecision[],
  emitSite = "world/spheres/ledger.ts:recordSphereSponsorDecisions"
): Promise<SphereFlowLedgerEntry[]> {
  if (decisions.length === 0) return [];

  const createdAt = new Date();
  const docs: SphereFlowLedgerEntry[] = decisions.map((decision) => ({
    _id: new ObjectId(),
    turn: decision.turn,
    createdAt,
    kind: sponsorIntentToLedgerKind(decision.intent),
    fromEntityId: decision.sponsorId,
    toEntityId: decision.memberId,
    memberId: decision.memberId,
    sponsorId: decision.sponsorId,
    amount: 0,
    currencyCode: "USD",
    reason: decision.reason,
    boundsApplied: true,
    emitSite,
    controller: decision.controller,
    alignmentDelta: decision.alignmentDelta,
    integrationDelta: decision.integrationDelta,
  }));

  try {
    await db.collection<SphereFlowLedgerEntry>(SPHERE_FLOW_LEDGER_COLLECTION).insertMany(docs, {
      ordered: false,
    });
  } catch {
    // Best-effort; management must not abort the turn.
  }

  return docs;
}

export async function listSphereFlowLedgerForEntity(
  db: Db,
  memberId: string,
  limit = 50
): Promise<SphereFlowLedgerEntry[]> {
  return db
    .collection<SphereFlowLedgerEntry>(SPHERE_FLOW_LEDGER_COLLECTION)
    .find({ memberId })
    .sort({ turn: -1, createdAt: -1 })
    .limit(limit)
    .toArray();
}

import { ObjectId, type Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import { applyTensionEvent } from "@/lib/coldwar/tension";
import {
  getIntelligenceAgenciesCollection,
  getIntelligenceCoverageCollection,
  getIntelligenceNetworksCollection,
  getIntelligenceOpLogCollection,
} from "@/lib/db/collections/intelligence";
import type {
  IntelligenceAgency,
  IntelligenceDomain,
  OperationCompromise,
  OperationOutcome,
} from "@/lib/db/types/intelligence";
import {
  ACTION_COST,
  ACTION_DIFFICULTY,
  ACTION_MIN_COVERAGE,
  ACTION_MIN_NETWORK_LEVEL,
  COLLECTION_COST,
  COLLECTION_DIFFICULTY,
  COLLECTION_GAIN,
  COLLECTION_MIN_NETWORK_LEVEL,
  OP_SLOTS_PER_TURN,
  STRATEGIC_ATTRIBUTION_TENSION,
} from "./config";
import { clampCoverage, currentCoverage } from "./coverage";
import { applyOperationToNetwork, isNetworkUsable } from "./network";
import { resolveOperation } from "./resolveOperation";
import { readMilitarySabotageEnabled } from "./flags";
import { applyMilitaryAction, type MilitaryActionResult } from "./militaryAction";
import { applyStrategicAction, type StrategicActionResult } from "./strategicAction";

export type OperationKind = "collect" | "action";

export interface RunOperationArgs {
  db: Db;
  agency: IntelligenceAgency;
  targetCountryId: CountryId;
  domain: IntelligenceDomain;
  kind: OperationKind;
  opType: string;
  turn: number;
  statMultiplier: number;
  actorUserId: string | null;
  /** Injected so the resolver stays deterministic under test. */
  rolls?: { success: number; compromise: number };
}

export type RunOperationResult =
  | { ok: false; status: number; error: string }
  | {
      ok: true;
      outcome: OperationOutcome;
      compromise: OperationCompromise;
      coverage: number;
      networkLevel: number;
      networkStatus: string;
      message: string;
    };

function refuse(status: number, error: string): RunOperationResult {
  return { ok: false, status, error };
}

/**
 * Run one intelligence operation, end to end.
 *
 * Order matters and is deliberate: every gate is checked BEFORE anything is
 * spent, then effects are applied BEFORE compromise costs. That second ordering
 * is what stops `success + blown` from cancelling itself — a successful
 * collection keeps the coverage it bought even when the network burns for it.
 * Compromise costs future ACCESS, never intelligence already in hand.
 */
export async function runOperation(args: RunOperationArgs): Promise<RunOperationResult> {
  const { db, agency, targetCountryId, domain, kind, opType, turn, statMultiplier } = args;

  if (targetCountryId === agency.countryId) {
    return refuse(400, "A service cannot run an operation against its own country.");
  }

  const networks = await getIntelligenceNetworksCollection(db);
  const network = await networks.findOne({
    ownerCountryId: agency.countryId,
    targetCountryId,
  });
  if (!network) {
    return refuse(409, "There is no network in that country yet. Fund one first.");
  }
  if (!isNetworkUsable(network, turn)) {
    return refuse(409, "That network is burned and still cooling. It cannot be used yet.");
  }

  const coverageCollection = await getIntelligenceCoverageCollection(db);
  const coverageRow = await coverageCollection.findOne({
    ownerCountryId: agency.countryId,
    targetCountryId,
    domain,
  });
  const liveCoverage = coverageRow
    ? currentCoverage(coverageRow.valueAtCollection, turn - coverageRow.lastCollectedTurn)
    : 0;

  const minLevel = kind === "action" ? ACTION_MIN_NETWORK_LEVEL : COLLECTION_MIN_NETWORK_LEVEL;
  if (network.level < minLevel) {
    return refuse(409, `That operation needs a network at level ${minLevel} or better.`);
  }
  if (kind === "action" && liveCoverage < ACTION_MIN_COVERAGE) {
    return refuse(
      409,
      `Covert action needs at least ${ACTION_MIN_COVERAGE} coverage in that domain. You cannot act blind.`
    );
  }

  // ── Claim the budget and the slot ATOMICALLY ──────────────────────────────
  //
  // Read-then-write would let two concurrent operations each see one slot and a
  // full purse, both pass, and both spend: the country runs more operations than
  // it has and can overdraw. One conditional update instead, in the spirit of
  // `debitAppropriation`'s `$expr` guard, so the loser of a race simply does not
  // match and is refused.
  const cost = kind === "action" ? ACTION_COST : COLLECTION_COST;
  const agencies = await getIntelligenceAgenciesCollection(db);
  const claim = await agencies.updateOne(
    {
      _id: agency._id,
      budgetRemaining: { $gte: cost },
      // A budget stamped for an older turn is a full one, so it always qualifies.
      $or: [{ "opSlots.turn": { $ne: turn } }, { "opSlots.remaining": { $gt: 0 } }],
    },
    [
      {
        $set: {
          budgetRemaining: { $subtract: ["$budgetRemaining", cost] },
          opSlots: {
            turn,
            remaining: {
              $cond: [
                { $eq: ["$opSlots.turn", turn] },
                { $subtract: ["$opSlots.remaining", 1] },
                OP_SLOTS_PER_TURN - 1,
              ],
            },
          },
          updatedAt: "$$NOW",
        },
      },
    ]
  );
  if (claim.modifiedCount === 0) {
    // Re-read to say WHICH constraint refused, rather than guessing.
    const fresh = await agencies.findOne({ _id: agency._id });
    if (fresh && fresh.budgetRemaining < cost) {
      return refuse(409, "The service cannot afford that operation.");
    }
    return refuse(429, "The service has run every operation it can this turn.");
  }

  const difficulty = kind === "action" ? ACTION_DIFFICULTY : COLLECTION_DIFFICULTY;
  const successRoll = args.rolls?.success ?? Math.random();
  const compromiseRoll = args.rolls?.compromise ?? Math.random();
  // Read once: the resolver and the audit row must agree on the posture the
  // operation was actually judged against.
  const counterIntel = await readTargetCounterIntel(db, targetCountryId);
  const resolution = resolveOperation({
    networkLevel: network.level,
    coverage: liveCoverage,
    tradecraft: agency.tradecraft,
    statMultiplier,
    counterIntel,
    suspicion: network.suspicion,
    difficulty,
    successRoll,
    compromiseRoll,
  });

  // ── Effects first ─────────────────────────────────────────────────────────
  let coverageAfter = liveCoverage;
  if (resolution.outcome === "success" && kind === "collect") {
    coverageAfter = clampCoverage(liveCoverage + COLLECTION_GAIN);
    await coverageCollection.updateOne(
      { ownerCountryId: agency.countryId, targetCountryId, domain },
      {
        $set: {
          valueAtCollection: coverageAfter,
          lastCollectedTurn: turn,
          updatedAt: new Date(),
        },
        $setOnInsert: { ownerCountryId: agency.countryId, targetCountryId, domain },
      },
      { upsert: true }
    );
  }

  // A successful strategic ACTION is the only thing in phase 2 that changes the
  // world. Reaching it required exact-tier coverage through the action gate, so
  // the operator has genuinely found the programme rather than guessed at it.
  let strategicEffect: StrategicActionResult | null = null;
  let militaryEffect: MilitaryActionResult | null = null;
  if (kind === "action" && resolution.outcome === "success") {
    if (domain === "strategic") {
      strategicEffect = await applyStrategicAction(db, agency.countryId, targetCountryId, turn);
    } else if (domain === "military") {
      // Gated: the magnitudes are a balance change and their report could not be
      // produced (no engaged front in the live world). While off, the operation
      // still resolves and still costs and risks everything it normally does; it
      // simply lands on nothing, and says so.
      militaryEffect = (await readMilitarySabotageEnabled(db))
        ? await applyMilitaryAction(db, targetCountryId)
        : { frontSabotaged: null, formationsDegraded: 0 };
    }
  }

  // ── Compromise costs after ────────────────────────────────────────────────
  const networkAfter = applyOperationToNetwork(network, resolution.compromise, turn);
  await networks.updateOne(
    { _id: network._id },
    {
      $set: {
        level: networkAfter.level,
        suspicion: networkAfter.suspicion,
        status: networkAfter.status,
        cooledUntilTurn: networkAfter.cooledUntilTurn,
        lastOpTurn: networkAfter.lastOpTurn,
        updatedAt: networkAfter.updatedAt,
      },
    }
  );

  const message = describeOperation(
    kind,
    resolution.outcome,
    resolution.compromise,
    strategicEffect,
    militaryEffect
  );

  const opLog = await getIntelligenceOpLogCollection(db);
  await opLog.insertOne({
    _id: new ObjectId(),
    ownerCountryId: agency.countryId,
    targetCountryId,
    domain,
    opType,
    directorCharacterId: agency.directorCharacterId,
    actorUserId: args.actorUserId,
    outcome: resolution.outcome,
    compromise: resolution.compromise,
    rollDetail: {
      networkLevel: network.level,
      coverage: liveCoverage,
      tradecraft: agency.tradecraft,
      statMultiplier,
      counterIntel,
      suspicion: network.suspicion,
      difficulty,
      successRoll,
      compromiseRoll,
    },
    budgetSpent: cost,
    slotsSpent: 1,
    effectSummary: message,
    turn,
    createdAt: new Date(),
  });

  // An ATTRIBUTED strategic operation is a world event, not a private one: the
  // target and everyone else can name whose service it was. Additive to a capped
  // ledger, so existing rows need no migration.
  if (domain === "strategic" && resolution.compromise === "attributed") {
    await applyTensionEvent(
      db,
      turn,
      "espionage",
      `${agency.countryId} caught running an operation against ${targetCountryId}`,
      STRATEGIC_ATTRIBUTION_TENSION
    );
  }

  return {
    ok: true,
    outcome: resolution.outcome,
    compromise: resolution.compromise,
    coverage: coverageAfter,
    networkLevel: networkAfter.level,
    networkStatus: networkAfter.status,
    message,
  };
}

/**
 * The target's defensive posture.
 *
 * A country with no agency row has never stood a service up, so it defends at
 * zero rather than at the default: the default belongs to a service that exists.
 */
async function readTargetCounterIntel(db: Db, targetCountryId: CountryId): Promise<number> {
  const agencies = await getIntelligenceAgenciesCollection(db);
  const target = await agencies.findOne(
    { countryId: targetCountryId },
    { projection: { counterIntel: 1 } }
  );
  return target?.counterIntel ?? 0;
}

/** Player-facing sentence. No dashes, per the copy rule. */
function describeOperation(
  kind: OperationKind,
  outcome: OperationOutcome,
  compromise: OperationCompromise,
  strategicEffect: StrategicActionResult | null,
  militaryEffect: MilitaryActionResult | null
): string {
  // A strategic action can succeed against a country that simply has nothing
  // undeclared to break. Reporting that as "did what it was sent to do" would be
  // a lie, and refusing it at the gate would leak whether a programme exists to
  // an operator whose coverage has not earned that answer.
  const emptyStrategic = strategicEffect !== null && !strategicEffect.sabotaged;
  // Same honesty rule for a military action that reached a country with nothing
  // to break: no front to cut and no formations to reach.
  const emptyMilitary =
    militaryEffect !== null &&
    militaryEffect.frontSabotaged === null &&
    militaryEffect.formationsDegraded === 0;

  const did =
    outcome === "success"
      ? kind === "collect"
        ? "The station filed a usable report."
        : emptyStrategic || emptyMilitary
          ? "The team reached the site and found nothing worth breaking."
          : strategicEffect?.crackdown === true
            ? "The programme lost ground, and the raid was public."
            : "The operation did what it was sent to do."
      : kind === "collect"
        ? "The station came back with nothing usable."
        : "The operation failed to achieve anything.";

  const cost = {
    clean: "Nobody noticed.",
    blown: "A cell was rolled up on the way out, and the network is thinner for it.",
    detected: "They know an operation was run. They do not know whose.",
    attributed: "They know exactly whose service it was, and so does everyone else.",
  }[compromise];

  return `${did} ${cost}`;
}

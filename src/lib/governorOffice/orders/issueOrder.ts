import type { Db, ObjectId } from "mongodb";
import { ObjectId as MongoObjectId } from "mongodb";
import type {
  GovernorExecutiveOrder,
  GovernorOfficeState,
  LegislationType,
  StatePolicy,
} from "@/lib/db/types";
import { type CountryId, getExecutiveOrderName } from "@/lib/constants/countries";
import {
  EXEC_ORDER_DURATION_TURNS,
  EXEC_ORDER_SLOT_CAP,
  EXEC_ORDER_AP_COST_PER_STEP,
  EXEC_ORDER_MAX_STEPS,
} from "@/lib/constants/governorOffice";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { generateOrderNews } from "@/lib/news";
import { ladderBounds } from "@/lib/legislature/policyLadder";
import { regionalDefaultLevel } from "@/lib/politicalLegislation/regionalDefaults";

export interface IssueOrderInput {
  countryId: CountryId;
  stateId: string;
  characterId: ObjectId;
  characterName: string;
  legislationTypeId: string;
  effectDirection: 1 | -1;
  /** Steps to shift (1 or 2). Defaults to 1 when omitted. */
  steps?: 1 | 2;
  /**
   * Policy scope this order targets. State governor's orders use "state"
   * (default); president's federal orders use "national". Drives the
   * scope written on the StatePolicy upsert when no prior policy row exists.
   */
  scope?: "state" | "national";
  /**
   * Admin override — bypasses AP cost. Routes must verify the caller is
   * actually an admin before passing this through.
   */
  adminOverride?: boolean;
}

export interface IssueOrderResult {
  status: number;
  body: {
    orderId?: string;
    error?: string;
    policyOptionIndexAfter?: number;
    expiresAtTurn?: number;
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Issue an executive order — a time-bounded state-policy nudge that shifts
 * the underlying StatePolicy by ±1 for EXEC_ORDER_DURATION_TURNS turns or
 * until rescinded / superseded.
 */
export async function issueOrder(db: Db, input: IssueOrderInput): Promise<IssueOrderResult> {
  const now = new Date();
  const currentTurn = await getCurrentTurn(db);
  const { countryId, stateId, characterId, characterName, legislationTypeId, effectDirection } =
    input;
  const steps = (input.steps ?? 1) as 1 | 2;
  const scope = input.scope ?? "state";
  const adminOverride = input.adminOverride === true;
  if (steps !== 1 && steps !== 2) {
    return { status: 400, body: { error: "Invalid step count." } };
  }
  if (steps > EXEC_ORDER_MAX_STEPS) {
    return { status: 400, body: { error: "Step count exceeds maximum." } };
  }
  const apCost = adminOverride ? 0 : steps * EXEC_ORDER_AP_COST_PER_STEP;

  if (!adminOverride) {
    const officeState = await db
      .collection<GovernorOfficeState>("governorOfficeState")
      .findOne({ countryId, stateId });
    if (!officeState || officeState.gubernatorialActions < apCost) {
      return { status: 400, body: { error: "Insufficient office action points." } };
    }
  }

  const activeOrders = await db
    .collection<GovernorExecutiveOrder>("governorExecutiveOrders")
    .find({ countryId, stateId, status: "active" })
    .toArray();
  if (activeOrders.length >= EXEC_ORDER_SLOT_CAP) {
    return { status: 400, body: { error: "Both executive-order slots are in use." } };
  }
  if (activeOrders.some((o) => o.legislationTypeId === legislationTypeId)) {
    return { status: 409, body: { error: "An active order already exists for this policy." } };
  }

  const priorPolicy = await db
    .collection<StatePolicy>("statePolicies")
    .findOne({ stateId, legislationTypeId });

  // The ladder's bounds come from THIS type's option set, not the 7-option
  // (0–6) shape most types happen to have. A three-option type like the state
  // redistricting authority act has no index 3 to default to and no index 6 to
  // clamp at, so the old constants let an order write a policyOptionIndex no
  // option exists at — which downstream readers then silently reinterpret
  // (redistricting caps clamp an out-of-range index back to the centre, so the
  // order claims one authority while the map enforces another). billEnactment
  // fixed the same class of bug on the bill path; this is the order path.
  // A type with no options ladder keeps the legacy 0–6 behaviour.
  const legType = await db
    .collection<LegislationType>("legislationTypes")
    .findOne({ _id: legislationTypeId });
  const { maxIndex, centerIndex } = ladderBounds(legType?.policyOptions?.length);
  // A region with no row for a new-generation `both` law sits at level 0, which
  // is what getEnactedLevel reports to the engine and what
  // /api/game/current-policies now reports to IssueOrderModal. Falling straight
  // through to the ladder centre made this write a level the region never had —
  // and disagree with the step the player was shown before they confirmed.
  // National scope keeps the centre: those rows ARE seeded, so a missing one
  // means something else is wrong and must not be quietly rewritten to 0.
  const regionalDefault = scope === "state" ? regionalDefaultLevel(legislationTypeId) : undefined;
  const before = clamp(
    priorPolicy?.policyOptionIndex ?? regionalDefault ?? centerIndex,
    0,
    maxIndex
  );
  const desired = before + effectDirection * steps;
  const after = clamp(desired, 0, maxIndex);
  if (after === before) {
    return {
      status: 400,
      body: { error: "Order would have no effect (clamped at policy boundary)." },
    };
  }
  if (after !== desired) {
    return {
      status: 400,
      body: {
        error: `Order would clamp at policy boundary — pick ${Math.abs(after - before)} step(s) instead.`,
      },
    };
  }

  // The real policyOption at the new index, so the upsert writes a valid id and
  // axis values rather than sentinels. Falls back to the prior values if the
  // LegislationType row is missing policy options.
  const newOption = legType?.policyOptions?.[after];
  const resolvedPolicyOptionId = newOption?.id ?? priorPolicy?.policyOptionId ?? "order-shift";
  const resolvedEconomic = newOption?.economic ?? priorPolicy?.economic ?? 0;
  const resolvedSocial = newOption?.social ?? priorPolicy?.social ?? 0;

  const orderId = new MongoObjectId();
  const order: GovernorExecutiveOrder = {
    _id: orderId,
    countryId,
    stateId,
    issuedByCharacterId: characterId,
    issuedByName: characterName,
    legislationTypeId,
    effectDirection,
    steps,
    policyOptionIndexBefore: before,
    policyOptionIndexAfter: after,
    ...(priorPolicy?.policyOptionId ? { policyOptionIdBefore: priorPolicy.policyOptionId } : {}),
    economicBefore: priorPolicy?.economic ?? 0,
    socialBefore: priorPolicy?.social ?? 0,
    issuedAtTurn: currentTurn,
    expiresAtTurn: currentTurn + EXEC_ORDER_DURATION_TURNS,
    status: "active",
    ...(adminOverride ? { adminProposed: true } : {}),
    createdAt: now,
    updatedAt: now,
  };
  await db.collection<GovernorExecutiveOrder>("governorExecutiveOrders").insertOne(order);

  // Write the new option's axis values so consumers that match by
  // (economic, social) — like the State Policy page — display the correct
  // option name. The before-snapshot lives on the order doc for revert.
  const policyDoc: Partial<StatePolicy> = {
    stateId,
    legislationTypeId,
    policyOptionIndex: after,
    policyOptionId: resolvedPolicyOptionId,
    enactedAt: now,
    enactedTurn: currentTurn,
    enactedBy: { kind: "order", id: orderId },
    economic: resolvedEconomic,
    social: resolvedSocial,
    effectDirection: effectDirection as number,
    scope: priorPolicy?.scope ?? scope,
  };
  await db.collection<StatePolicy>("statePolicies").updateOne(
    { stateId, legislationTypeId },
    {
      $set: policyDoc,
      $unset: { enactedByBillId: "" },
    },
    { upsert: true }
  );

  if (!adminOverride) {
    await db
      .collection<GovernorOfficeState>("governorOfficeState")
      .updateOne(
        { countryId, stateId },
        { $inc: { gubernatorialActions: -apCost }, $set: { updatedAt: now } }
      );
  }

  // Post to the news wire. Best-effort — never abort the issuance over a news
  // failure. The Discord bot's pull-based news endpoint surfaces these in the
  // "executive" category alongside addresses.
  try {
    const isNational = scope === "national";
    // Order name follows the country's government type at BOTH scopes —
    // a UK FM issues an "Order in Council" not an "Executive Order".
    await generateOrderNews({
      scope: isNational ? "national" : "state",
      orderName: getExecutiveOrderName(countryId),
      legislationTypeName: legType?.name ?? legislationTypeId,
      policyOptionNameBefore: legType?.policyOptions?.[before]?.name ?? null,
      policyOptionNameAfter: legType?.policyOptions?.[after]?.name ?? null,
      issuedByName: characterName,
      countryId,
      ...(isNational ? {} : { state: stateId }),
    });
  } catch {
    // Swallow — news is non-critical for the issuance flow.
  }

  return {
    status: 200,
    body: {
      orderId: orderId.toString(),
      policyOptionIndexAfter: after,
      expiresAtTurn: order.expiresAtTurn,
    },
  };
}

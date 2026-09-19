// POST /api/country/[code]/executive/cabinet/[positionId]/order
// Auth: requireAuth — must be cabinet holder or admin
// Errors: 400, 401, 403, 404
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { getCabinetMechanics } from "@/lib/constants/cabinetMechanics";
import { initialMinisterialActionFields } from "@/lib/cabinet/ministerialActionPool";
import { getMinisterialOrders } from "@/lib/constants/cabinetOrders";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { resolveMetricPath } from "@/lib/cabinet/resolveMetricPath";
import { getCabinetMembersCollection } from "@/lib/db/collections/cabinetMembers";
import { getMinisterialOrdersCollection } from "@/lib/db/collections/cabinetSettings";
import { getGameState } from "@/lib/gameState";
import {
  computeMinisterialOrderExpiresTurn,
  expireMinisterialOrders,
  isMinisterialOrderActive,
} from "@/lib/cabinet/ministerialOrderLifecycle";
import { ObjectId } from "mongodb";
import { z } from "zod";

const orderSchema = z.object({
  orderId: z.string(),
  // National orders carry no region; the client sends `null` for them. Accept
  // null (not just undefined) so a national order validates — the turn engine
  // ignores regionId for national-scope effects anyway.
  targetRegionId: z.string().nullable().optional(),
  regionId: z.string().nullable().optional(),
});

interface RouteParams {
  params: Promise<{ code: string; positionId: string }>;
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const { code, positionId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country" }, { status: 400 });
    }

    const mechanics = getCabinetMechanics(countryId, positionId);
    if (!mechanics) {
      return NextResponse.json({ error: "Unknown cabinet position" }, { status: 404 });
    }

    const availableOrders = getMinisterialOrders(countryId, positionId);
    if (!availableOrders.length && !mechanics.emergency) {
      return NextResponse.json({ error: "Unknown cabinet position" }, { status: 404 });
    }

    const parsed = await parseJsonBody(request, orderSchema);
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });

    const metricConfigs = [...mechanics.nationalMetrics, ...mechanics.regionalMetrics];
    // Normalize a `null` region (national orders) to `undefined` so it stores as
    // an absent regionId rather than null on the order's effect docs.
    const targetRegionId = parsed.data.targetRegionId ?? parsed.data.regionId ?? undefined;
    const emergencyOrderId = `emergency_${positionId}`;
    const orderConfig =
      parsed.data.orderId === emergencyOrderId && mechanics.emergency
        ? {
            id: emergencyOrderId,
            name: mechanics.emergency.name,
            duration: mechanics.emergency.duration,
            effects: Object.entries(mechanics.emergency.effects).map(([metric, modifier]) => ({
              metric: resolveMetricPath(metric, metricConfigs),
              modifier,
              scope: "regional" as const,
            })),
          }
        : availableOrders.find((o) => o.id === parsed.data.orderId);
    if (!orderConfig) {
      return NextResponse.json({ error: "Invalid order ID" }, { status: 400 });
    }

    // Regional-scope orders need a target region. Without one the effect is
    // dropped at turn time (the engine only applies regional effects with a
    // regionId), silently wasting a ministerial action — reject up front.
    const isRegionalOrder = orderConfig.effects.some((e) => e.scope === "regional");
    if (isRegionalOrder && !targetRegionId) {
      return NextResponse.json({ error: "Select a target region" }, { status: 400 });
    }

    const db = await getDb();
    const membersCol = getCabinetMembersCollection(db);
    const member = await membersCol.findOne({ countryId, positionId });

    // Auth: must be holder or admin
    const isHolder =
      member &&
      member.characterId &&
      auth.user.character &&
      member.characterId.toString() === auth.user.character._id.toString();
    if (!isHolder && !auth.user.isAdmin) {
      return NextResponse.json(
        { error: "Only the cabinet holder or admin can issue orders" },
        { status: 403 }
      );
    }

    // Backfill missing action fields on legacy members. Pre-fix nominations and
    // admin force-confirms inserted cabinetMembers without ministerialActions /
    // lastMinisterialActionResetDay, which makes the atomic `$gte: 1` spend below
    // silently fail (MongoDB doesn't match $gte against missing fields).
    if (
      member &&
      (member.ministerialActions == null || member.lastMinisterialActionResetDay == null)
    ) {
      const backfill = {
        ...initialMinisterialActionFields(),
        ...(member.ministerialActions != null
          ? { ministerialActions: member.ministerialActions }
          : {}),
      };
      await membersCol.updateOne({ _id: member._id }, { $set: backfill });
      member.ministerialActions = backfill.ministerialActions;
      member.lastMinisterialActionResetDay = backfill.lastMinisterialActionResetDay;
    }

    // Check action pool
    const actions = member?.ministerialActions ?? 2;
    if (actions < 1) {
      return NextResponse.json({ error: "No ministerial actions remaining" }, { status: 400 });
    }

    const gameState = await getGameState();
    const currentTurn = gameState?.currentTurn ?? 1;

    const ordersCol = getMinisterialOrdersCollection(db);
    await expireMinisterialOrders(db, currentTurn);

    const activeSameOrder = await ordersCol
      .find({
        countryId,
        positionId,
        orderId: orderConfig.id,
        active: true,
      })
      .toArray();
    if (activeSameOrder.some((order) => isMinisterialOrderActive(order, currentTurn))) {
      return NextResponse.json(
        { error: "This order is already active for this position" },
        { status: 409 }
      );
    }

    // Create the order
    const effects = orderConfig.effects.map((e) => ({
      ...e,
      metric: resolveMetricPath(e.metric, metricConfigs),
      regionId: e.scope === "regional" ? targetRegionId : undefined,
    }));

    const spendResult = await membersCol.updateOne(
      { _id: member!._id, ministerialActions: { $gte: 1 } },
      { $inc: { ministerialActions: -1 } }
    );
    if (spendResult.modifiedCount === 0) {
      return NextResponse.json({ error: "No ministerial actions remaining" }, { status: 409 });
    }

    try {
      await ordersCol.insertOne({
        _id: new ObjectId(),
        countryId,
        positionId,
        characterId: member!.characterId,
        orderId: orderConfig.id,
        orderName: orderConfig.name,
        effects,
        issuedAt: new Date(),
        issuedTurn: currentTurn,
        duration: orderConfig.duration,
        expiresTurn: computeMinisterialOrderExpiresTurn(currentTurn, orderConfig.duration),
        active: true,
        createdAt: new Date(),
      });
    } catch (error) {
      await membersCol.updateOne({ _id: member!._id }, { $inc: { ministerialActions: 1 } });
      throw error;
    }

    return NextResponse.json({ success: true, actionsRemaining: actions - 1 });
  } catch (error) {
    return handleRouteError(error);
  }
}

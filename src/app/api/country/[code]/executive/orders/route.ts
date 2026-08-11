import { NextResponse } from "next/server";
import { z } from "zod";
import { requireHumanSessionWithCharacter, requireAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { getDb } from "@/lib/mongodb";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getNationalStateId } from "@/lib/policy/nationalStateId";
import { issueOrder } from "@/lib/governorOffice/orders/issueOrder";
import { isSittingLeader } from "@/lib/governorOffice/isSittingLeader";
import type { GovernorOfficeState, GameState, LegislationType } from "@/lib/db/types";

/**
 * Federal Executive Orders — head-of-government equivalent of Governor's
 * Office orders. Operates on the same `governorExecutiveOrders` collection
 * with stateId set to the country's national pseudo-state id (e.g. "federal"
 * for US, "uk_national" for UK). Issuable by the sitting President (US) or
 * Prime Minister / Chancellor (parliamentary countries) — surfaced in the
 * UI as "Executive Order" (US) or "Order in Council" (parliamentary) via
 * `getExecutiveOrderName(countryId)`.
 */

// POST /api/country/[code]/executive/orders — Sitting head of government
// issues a national order (Executive Order for US, Order in Council for
// parliamentary countries).
// Auth: requireHumanSessionWithCharacter; must be the seated leader.
// Errors: 400, 401, 403, 409
export async function POST(request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country" }, { status: 400 });
    }

    const auth = await requireHumanSessionWithCharacter(request);
    if (!auth.ok) return auth.response;

    const db = await getDb();

    const parsed = await parseJsonBody(
      request,
      z.object({
        legislationTypeId: z.string().min(1),
        effectDirection: z.union([z.literal(1), z.literal(-1)]),
        steps: z.union([z.literal(1), z.literal(2)]).optional(),
        adminOverride: z.boolean().optional(),
      })
    );
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });

    const isAdmin = auth.user.isAdmin === true;
    const adminOverride = parsed.data.adminOverride === true && isAdmin;
    const leader = await isSittingLeader(db, countryId, auth.user.character._id);
    if (!leader && !adminOverride) {
      return NextResponse.json(
        { error: "Only the sitting leader can issue national orders" },
        { status: 403 }
      );
    }

    const stateId = getNationalStateId(countryId);
    const result = await issueOrder(db, {
      countryId,
      stateId,
      characterId: auth.user.character._id,
      characterName: auth.user.character.name,
      legislationTypeId: parsed.data.legislationTypeId,
      effectDirection: parsed.data.effectDirection,
      steps: parsed.data.steps,
      scope: "national",
      adminOverride,
    });
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    return handleRouteError(error);
  }
}

// GET /api/country/[code]/executive/orders — Active + recent national orders.
// Auth: viewer must be the sitting head of government or admin.
export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country" }, { status: 400 });
    }

    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const leader = auth.user.character
      ? await isSittingLeader(db, countryId, auth.user.character._id)
      : false;
    const isAdmin = auth.user.isAdmin === true;
    if (!leader && !isAdmin) {
      return NextResponse.json({ error: "Not the sitting leader" }, { status: 403 });
    }

    const stateId = getNationalStateId(countryId);

    // Pull the data needed by WhiteHouseOrdersTab in one round-trip:
    // active orders, history, AP balance, current turn, and national
    // legislation types (id + name + policyOptions for from/to display).
    const [active, history, officeState, gameStateDoc, legislationTypes] = await Promise.all([
      db
        .collection("governorExecutiveOrders")
        .find({ countryId, stateId, status: "active" })
        .toArray(),
      db
        .collection("governorExecutiveOrders")
        .find({ countryId, stateId, status: { $in: ["expired", "rescinded", "superseded"] } })
        .sort({ issuedAtTurn: -1 })
        .limit(10)
        .toArray(),
      db.collection<GovernorOfficeState>("governorOfficeState").findOne({ countryId, stateId }),
      db.collection<GameState>("gameState").findOne({ _id: "current" }),
      db
        .collection<LegislationType>("legislationTypes")
        .find({
          taxRateChange: { $exists: false },
          $or: [{ allowedScope: "national" }, { allowedScope: "both" }, { nationalOnly: true }],
          $and: [
            countryId === COUNTRY_CONFIGS.US.id
              ? {
                  $or: [{ countryScope: "us" as const }, { countryScope: { $exists: false } }],
                }
              : { countryScope: countryId.toLowerCase() as LegislationType["countryScope"] },
          ],
        })
        .project<{ _id: string; name: string; policyOptions?: { id: string; name: string }[] }>({
          _id: 1,
          name: 1,
          "policyOptions.id": 1,
          "policyOptions.name": 1,
        })
        .toArray(),
    ]);

    const typeById = new Map(legislationTypes.map((t) => [t._id, t]));

    type RawOrder = {
      _id: import("mongodb").ObjectId;
      legislationTypeId: string;
      effectDirection: 1 | -1;
      policyOptionIndexBefore: number;
      policyOptionIndexAfter: number;
      expiresAtTurn: number;
      issuedByName: string;
      issuedAtTurn: number;
      status: "active" | "expired" | "rescinded" | "superseded";
      rescindedAtTurn?: number;
    };

    function shapeOrder(o: RawOrder) {
      const type = typeById.get(o.legislationTypeId);
      return {
        _id: o._id.toString(),
        legislationTypeId: o.legislationTypeId,
        legislationTypeName: type?.name ?? o.legislationTypeId,
        effectDirection: o.effectDirection,
        policyOptionNameBefore: type?.policyOptions?.[o.policyOptionIndexBefore]?.name ?? null,
        policyOptionNameAfter: type?.policyOptions?.[o.policyOptionIndexAfter]?.name ?? null,
        status: o.status,
        issuedByName: o.issuedByName,
        issuedAtTurn: o.issuedAtTurn,
        expiresAtTurn: o.expiresAtTurn,
        rescindedAtTurn: o.rescindedAtTurn ?? null,
      };
    }

    return NextResponse.json({
      active: (active as unknown as RawOrder[]).map(shapeOrder),
      history: (history as unknown as RawOrder[]).map(shapeOrder),
      gubernatorialActions: officeState?.gubernatorialActions ?? 0,
      currentTurn: gameStateDoc?.currentTurn ?? 0,
      legislationTypes: legislationTypes.map((t) => ({ id: t._id, name: t.name })),
      viewerIsLeader: leader,
      viewerIsAdmin: isAdmin,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

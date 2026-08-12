// PUT /api/country/[code]/executive/cabinet/[positionId]/formations
// Save the country's Combat Command org layer (unit formations + per-unit roles).
// Auth: defense holder or admin. Gated by conflictsEnabled + defense seat. Client-
// authoritative (org data grants no resources) with light server validation.
// Errors: 400, 401, 403, 404.
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getCabinetMembersCollection } from "@/lib/db/collections/cabinetMembers";
import { getGameStateCollection } from "@/lib/db/collections/gameState";
import { getMilitaryUnitsCollection } from "@/lib/db/collections/militaryUnits";
import { getMilitaryFormationsCollection } from "@/lib/db/collections/militaryFormations";
import { DEFENSE_POSITION_BY_COUNTRY } from "@/lib/constants/military";
import { ROLES } from "@/lib/military/combat";
import { validateAssignments } from "@/lib/military/assignments";
import { reconcileUnitTheaters } from "@/lib/military/reconcileTheaters";
import { verifyPosting } from "@/lib/military/rosterGate";
import { listCountryGenerals } from "@/lib/db/collections/characterGenerals";

// The retired `formations` array (with its fabricable `general: z.any()`) is gone.
// A general is now a characterId validated against the country's real roster, and
// their stats are resolved server-side from characterGenerals.
const assignmentSchema = z.object({
  theaterId: z.string(),
  generalCharacterId: z.string(),
  inCharge: z.boolean(),
});
// Both halves are optional and patched independently: the Combat Command page owns
// roles, the SecDef office owns assignments. If either were required, whichever page
// PUT last would clobber the other's half with an empty object.
const bodySchema = z.object({
  positions: z.record(z.string(), z.string()).optional(),
  conflictAssignments: z.array(assignmentSchema).optional(),
});

interface RouteParams {
  params: Promise<{ code: string; positionId: string }>;
}

export async function PUT(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const { code, positionId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country" }, { status: 400 });
    }
    if (DEFENSE_POSITION_BY_COUNTRY[countryId] !== positionId) {
      return NextResponse.json(
        { error: "Formations are managed from the defence minister’s office." },
        { status: 404 }
      );
    }

    const parsed = await parseJsonBody(request, bodySchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();
    const gsCol = await getGameStateCollection(db);
    const gs = await gsCol.findOne({ _id: "current" }, { projection: { conflictsEnabled: 1 } });
    if (!gs?.conflictsEnabled) {
      return NextResponse.json({ error: "Conflicts subsystem disabled" }, { status: 404 });
    }

    const member = await getCabinetMembersCollection(db).findOne({ countryId, positionId });
    const isHolder =
      member?.characterId &&
      auth.user.character &&
      member.characterId.toString() === auth.user.character._id.toString();
    if (!isHolder && !auth.user.isAdmin) {
      return NextResponse.json(
        { error: "Only the defence minister may edit formations." },
        { status: 403 }
      );
    }

    // Referential integrity: own units only, valid roles, and every assignment
    // naming a real general of this country (never a client-supplied stat block).
    const { positions, conflictAssignments } = parsed.data;
    const ownUnits = new Set(
      (await getMilitaryUnitsCollection(db).find({ countryId }).project({ _id: 1 }).toArray()).map(
        (u) => String(u._id)
      )
    );
    const validRoles = new Set(ROLES.map((r) => r.id));
    for (const [uid, role] of Object.entries(positions ?? {})) {
      if (!ownUnits.has(uid)) {
        return NextResponse.json(
          { error: "That layout references a unit that does not belong to this country." },
          { status: 400 }
        );
      }
      if (!validRoles.has(role)) {
        return NextResponse.json(
          { error: "That unit was given a role that does not exist." },
          { status: 400 }
        );
      }
    }

    if (conflictAssignments) {
      // Every posting must name a live conflict (or homeland reserve).
      for (const a of conflictAssignments) {
        const verdict = await verifyPosting(db, countryId, a.theaterId);
        if (verdict === "unknown-theatre") {
          return NextResponse.json(
            { error: "That conflict is no longer live — a general cannot be posted to it." },
            { status: 400 }
          );
        }
        if (verdict === "not-a-belligerent") {
          return NextResponse.json(
            {
              error:
                "Your nation is not a belligerent in that conflict. Entry is decided by a bloc resolution and a vote of your legislature.",
            },
            { status: 400 }
          );
        }
      }
      const validGenerals = new Set((await listCountryGenerals(db, countryId)).map((g) => g.id));
      const error = validateAssignments(conflictAssignments, { validGenerals });
      if (error) return NextResponse.json({ error }, { status: 400 });
    }

    // Patch only what was sent, so one page's save never erases the other's half.
    const $set: Record<string, unknown> = {};
    if (positions) $set.positions = positions;
    if (conflictAssignments) $set.conflictAssignments = conflictAssignments;
    if (Object.keys($set).length === 0) {
      return NextResponse.json({ error: "Nothing was sent to save." }, { status: 400 });
    }

    await getMilitaryFormationsCollection(db).updateOne(
      { countryId },
      { $set, $setOnInsert: { countryId } },
      { upsert: true }
    );
    // Re-posting a general here moves the units assigned to them, exactly as on the
    // CG page: reconcile theaters whenever assignments were part of this patch.
    if (conflictAssignments) {
      await reconcileUnitTheaters(db, countryId, conflictAssignments);
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleRouteError(error);
  }
}

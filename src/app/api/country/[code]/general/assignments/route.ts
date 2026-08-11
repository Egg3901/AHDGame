// PUT /api/country/[code]/general/assignments
// A Commanding General posts the generals of their own Command to Conflicts and
// designates one Theater Commander per Conflict. Auth: the CG of a Command in this
// country (authority comes from being commandingGeneralId, not from a cabinet seat).
// Gated by conflictsEnabled. Errors: 400, 401, 403, 404.
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { requireCommandingGeneral } from "@/lib/api/requireCommandingGeneral";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getGameStateCollection } from "@/lib/db/collections/gameState";
import {
  getMilitaryFormations,
  getMilitaryFormationsCollection,
} from "@/lib/db/collections/militaryFormations";
import { listCountryGenerals } from "@/lib/db/collections/characterGenerals";
import { validateAssignments } from "@/lib/military/assignments";
import { reconcileUnitTheaters } from "@/lib/military/reconcileTheaters";
import { isValidUnitLocation } from "@/lib/military/theaters";

const assignmentSchema = z.object({
  theaterId: z.string(),
  generalCharacterId: z.string(),
  inCharge: z.boolean(),
});
const bodySchema = z.object({ conflictAssignments: z.array(assignmentSchema) });

interface RouteParams {
  params: Promise<{ code: string }>;
}

export async function PUT(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const { code } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country" }, { status: 400 });
    }

    const db = await getDb();
    const gs = await (
      await getGameStateCollection(db)
    ).findOne({ _id: "current" }, { projection: { conflictsEnabled: 1 } });
    if (!gs?.conflictsEnabled) {
      return NextResponse.json({ error: "Conflicts subsystem disabled" }, { status: 404 });
    }

    const characterId = auth.user.character?._id?.toString() ?? null;
    const cg = await requireCommandingGeneral(db, countryId, characterId);
    if (!cg.ok) return cg.response;

    const parsed = await parseJsonBody(request, bodySchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const submitted = parsed.data.conflictAssignments;

    // A CG commands their own Command, not the whole army.
    const ownGenerals = new Set(cg.command.commanderIds);
    if (submitted.some((a) => !ownGenerals.has(a.generalCharacterId))) {
      return NextResponse.json(
        { error: "You can post only the generals of your own command." },
        { status: 400 }
      );
    }

    // Every posting must name a live conflict (or homeland reserve) — conflicts are
    // created during play, so this is a DB check, not a static-set membership test.
    for (const a of submitted) {
      if (!(await isValidUnitLocation(db, a.theaterId))) {
        return NextResponse.json(
          { error: "That conflict is no longer live — a general cannot be posted to it." },
          { status: 400 }
        );
      }
    }

    // Merge, don't replace: every CG in the country writes to one shared array, so
    // rewriting it wholesale would wipe the other commands' postings. Drop only the
    // rows this CG owns, then splice their submission back in.
    const { conflictAssignments: stored } = await getMilitaryFormations(db, countryId);
    const others = stored.filter((a) => !ownGenerals.has(a.generalCharacterId));
    const merged = [...others, ...submitted];

    const validGenerals = new Set((await listCountryGenerals(db, countryId)).map((g) => g.id));

    // Validate the merged whole: invariants like one-TC-per-conflict span commands.
    const error = validateAssignments(merged, { validGenerals });
    if (error) return NextResponse.json({ error }, { status: 400 });

    await getMilitaryFormationsCollection(db).updateOne(
      { countryId },
      { $set: { conflictAssignments: merged }, $setOnInsert: { countryId } },
      { upsert: true }
    );
    // Re-posting a general moves the units assigned to them: reconcile their theaters.
    await reconcileUnitTheaters(db, countryId, merged);
    return NextResponse.json({ ok: true, conflictAssignments: merged });
  } catch (error) {
    return handleRouteError(error);
  }
}

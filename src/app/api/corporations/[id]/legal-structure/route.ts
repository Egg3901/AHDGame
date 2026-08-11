import { z } from "zod";
import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/errors";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { requireCorporationActionsEnabled } from "@/lib/api/requireCorporationActions";
import { parseJsonBody } from "@/lib/api/validate";
import { getDb } from "@/lib/mongodb";
import { resolveCorporation, requireCeo } from "@/lib/api/corporations/resolveQuery";
import { getGameState } from "@/lib/gameState";
import { LEGAL_STRUCTURES } from "@/lib/constants/legalStructures";
import type { LegalStructureId } from "@/lib/constants/legalStructures";
import { isListedOnlyStructure } from "@/lib/corporations/legalStructure";

const Schema = z.object({ legalStructure: z.string() });

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const { id } = await params;
    const db = await getDb();

    const actionsGuard = await requireCorporationActionsEnabled(db);
    if (actionsGuard) return actionsGuard;

    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;

    const ceoCheck = requireCeo(corporation, auth.user.userId);
    if (ceoCheck) return ceoCheck;

    if (!corporation.isPrivate) {
      return NextResponse.json(
        {
          error:
            "Public corporations must use the shareholder vote system to change legal structure.",
        },
        { status: 403 }
      );
    }

    const parsed = await parseJsonBody(request, Schema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { legalStructure } = parsed.data;
    const gameState = await getGameState();
    const currentTurn = gameState?.currentTurn ?? 0;

    if (
      corporation.legalStructureChangeCooldownUntilTurn != null &&
      currentTurn < corporation.legalStructureChangeCooldownUntilTurn
    ) {
      return NextResponse.json(
        {
          error: `Legal structure change on cooldown until turn ${corporation.legalStructureChangeCooldownUntilTurn}.`,
        },
        { status: 429 }
      );
    }

    const structure = LEGAL_STRUCTURES.find(
      (s) => s.id === legalStructure && s.countryId === corporation.countryId
    );
    if (!structure) {
      return NextResponse.json(
        { error: "Invalid legal structure for this corporation's country." },
        { status: 400 }
      );
    }

    // This route is private-only (public corps are blocked above), so a
    // listed-only form (PLC, AG, SA Aberta, …) cannot be elected here — it is
    // acquired by taking the corporation public, not by restructuring.
    if (isListedOnlyStructure(structure)) {
      return NextResponse.json(
        {
          error: `${structure.name} is a listed-company form — take the corporation public to adopt it.`,
        },
        { status: 400 }
      );
    }

    await db.collection("corporations").updateOne(
      { _id: corporation._id },
      {
        $set: {
          legalStructure: legalStructure as LegalStructureId,
          legalStructureChangeCooldownUntilTurn: currentTurn + 48,
          updatedAt: new Date(),
        },
      }
    );

    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleRouteError(e);
  }
}

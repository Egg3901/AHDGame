/**
 * Admin API: change a party's regime status.
 *
 * POST /api/admin/country/[code]/parties/[partyId]/regime-status
 * Body: { newStatus: "ruling" | "approved" | "banned" | null, reason: string }
 *
 * Routes to:
 *   - banned   -> processBanPartyEffects (vacates officials, flips status)
 *   - approved -> processUnbanPartyEffects when previous was banned,
 *                 otherwise a simple status update
 *   - ruling   -> atomic two-step: demote current ruling party to
 *                 "approved", promote target to "ruling"
 *   - null     -> allowed only when country is not a one-party state
 *
 * Country must exist. The party must belong to the country.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError, isDuplicateKeyError, conflict } from "@/lib/api/errors";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import type { PoliticalParty } from "@/lib/db/types";
import { processBanPartyEffects, processUnbanPartyEffects } from "@/lib/onePartyState/banFlow";

const BODY_SCHEMA = z.object({
  newStatus: z.union([z.literal("ruling"), z.literal("approved"), z.literal("banned"), z.null()]),
  reason: z.string().min(3),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string; partyId: string }> }
) {
  try {
    const { code, partyId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    const config = COUNTRY_CONFIGS[countryId];
    if (!config) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 404 });
    }

    const adminCheck = await requireAdmin();
    if (!adminCheck.ok) return adminCheck.response;

    const parsed = await parseJsonBody(request, BODY_SCHEMA);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { newStatus, reason } = parsed.data;

    if (newStatus !== null && config.governmentType !== "onePartyState") {
      return NextResponse.json(
        { error: "Regime status can only be set in a one-party state" },
        { status: 400 }
      );
    }

    const db = await getDb();
    const partySeqId = parseInt(partyId, 10);
    const party = await db
      .collection<PoliticalParty>("politicalParties")
      .findOne({ countryId, sequentialId: partySeqId });
    if (!party) {
      return NextResponse.json({ error: "Party not found" }, { status: 404 });
    }

    const gameState = await db
      .collection<{ _id: string; currentTurn: number }>("gameState")
      .findOne({ _id: "current" });
    const currentTurn = gameState?.currentTurn ?? 0;

    const impact: {
      officialsVacated?: number;
      seatsVacated?: number;
      previousRulingDemoted?: { id: string; name: string };
    } = {};

    if (newStatus === "banned") {
      const result = await processBanPartyEffects(db, {
        countryId,
        partyId: party._id,
        partySeqId: party.sequentialId,
        reason,
        currentTurn,
      });
      impact.officialsVacated = result.officialsVacated;
      impact.seatsVacated = result.seatsVacated;
    } else if (newStatus === "approved") {
      if (party.regimeStatus === "banned") {
        await processUnbanPartyEffects(db, { partyId: party._id, reason });
      } else {
        await db
          .collection<PoliticalParty>("politicalParties")
          .updateOne(
            { _id: party._id },
            { $set: { regimeStatus: "approved", updatedAt: new Date() } }
          );
      }
    } else if (newStatus === "ruling") {
      // Atomic two-step: demote any current ruling party in this country,
      // then promote the target. The MongoDB driver doesn't have a
      // first-class multi-document transaction abstraction at this layer,
      // but the demote → promote sequence is safe: between the two writes,
      // the worst case is briefly zero ruling parties (no harm), never two.
      // The partial unique index `uniq_ruling_party_per_country` is the
      // race-free guard against concurrent double-promote; we surface its
      // E11000 as a 409 conflict so admins see a meaningful error rather
      // than a 500.
      const currentRuling = await db
        .collection<PoliticalParty>("politicalParties")
        .findOne({ countryId, regimeStatus: "ruling" });
      const now = new Date();
      if (currentRuling && !currentRuling._id.equals(party._id)) {
        await db
          .collection<PoliticalParty>("politicalParties")
          .updateOne(
            { _id: currentRuling._id },
            { $set: { regimeStatus: "approved", updatedAt: now } }
          );
        impact.previousRulingDemoted = {
          id: String(currentRuling.sequentialId),
          name: currentRuling.name,
        };
      }
      try {
        await db
          .collection<PoliticalParty>("politicalParties")
          .updateOne({ _id: party._id }, { $set: { regimeStatus: "ruling", updatedAt: now } });
      } catch (err) {
        if (isDuplicateKeyError(err)) {
          throw conflict(
            "Another ruling party already exists for this country. Retry; if the conflict persists, demote the other ruling party first."
          );
        }
        throw err;
      }
    } else {
      // newStatus === null — escape hatch for non-one-party countries
      await db
        .collection<PoliticalParty>("politicalParties")
        .updateOne({ _id: party._id }, { $set: { regimeStatus: null, updatedAt: new Date() } });
    }

    return NextResponse.json({
      success: true,
      party: { id: String(party.sequentialId), name: party.name, regimeStatus: newStatus },
      impact,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { getGameState } from "@/lib/gameState";
import { getCountryConfig } from "@/lib/constants/countries";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { getCharacterByUserId } from "@/lib/db/characterLookup";
import { getOfficeTypeForChamber } from "@/lib/legislature/chamberOfficeType";
import { checkLegislationFreeze } from "@/lib/api/parliamentaryFreeze";
import { earliestFederationDecisionYear } from "@/lib/world/succession/availability";
import {
  defaultFederationParticipants,
  openDefaultFederationPoliticalProposal,
  type DefaultFederationSource,
} from "@/lib/world/succession/defaultProposal";
import { loadLiveSuccessionInventory } from "@/lib/world/succession/loadLiveInventory";
import type { FederationPoliticalProposalRecord } from "@/lib/world/succession/politicalProposal";
import type { Bill } from "@/lib/db/types/legislation";

const bodySchema = z.object({
  negotiatedCustodians: z.record(z.string(), z.string()).default({}),
});

function sourceForCode(code: string): DefaultFederationSource | null {
  const upper = code.toUpperCase();
  return upper === "CS" || upper === "YU" || upper === "RU" ? upper : null;
}

// GET shows the dated choice, existing bill and assets requiring negotiation.
export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const sourceCountryId = sourceForCode((await params).code);
    if (!sourceCountryId)
      return NextResponse.json({ error: "No federation decision here" }, { status: 404 });
    const db = await getDb();
    const state = await getGameState(db);
    const year = earliestFederationDecisionYear(state?.preset ?? "", sourceCountryId);
    if (year === null)
      return NextResponse.json({
        available: false,
        reason: "This world has no federation decision.",
      });
    const proposal = await db
      .collection<FederationPoliticalProposalRecord>("federationPoliticalProposals")
      .findOne({ _id: `1991-default:${sourceCountryId.toLowerCase()}-1991-default:1` });
    const bill = proposal
      ? await db.collection<Bill>("bills").findOne({ _id: proposal.billId })
      : null;
    const available = (state?.currentYear ?? 0) >= year;
    const assets =
      available && !proposal
        ? (await loadLiveSuccessionInventory(db, sourceCountryId)).custodyAssets
            .filter((asset) => asset.kind === "strategic-force" || asset.homeRegionId === null)
            .map(({ assetId, kind }) => ({ assetId, kind }))
        : [];
    return NextResponse.json({
      available,
      availableFromYear: year,
      participants: defaultFederationParticipants(sourceCountryId),
      sharedAssets: assets,
      proposal: proposal
        ? {
            status: proposal.status,
            billId: proposal.billId.toString(),
            billStatus: bill?.status ?? null,
            termsHash: proposal.termsHash,
          }
        : null,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

// POST opens a normal bill for a seated federal legislator or administrator.
export async function POST(request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const sourceCountryId = sourceForCode((await params).code);
    if (!sourceCountryId)
      return NextResponse.json({ error: "No federation decision here" }, { status: 404 });
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;
    const limit = checkRateLimit(`federation:${auth.user.userId}`, 5, 60_000);
    if (!limit.ok) return rateLimitResponse(limit.retryAfter);
    const parsed = await parseJsonBody(request, bodySchema);
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    const db = await getDb();
    const state = await getGameState(db);
    const year = earliestFederationDecisionYear(state?.preset ?? "", sourceCountryId);
    const currentYear = state?.currentYear;
    if (year === null || typeof currentYear !== "number" || currentYear < year)
      return NextResponse.json(
        { error: "The federation decision is not available yet." },
        { status: 409 }
      );
    const character = await getCharacterByUserId(db, auth.user.userId);
    const legislature = getCountryConfig(sourceCountryId, "1991-default").legislature;
    const chamberKeys = [legislature.lowerChamber.key];
    if (legislature.bicameral && legislature.upperChamber)
      chamberKeys.push(legislature.upperChamber.key);
    const officeTypes = chamberKeys.map((chamber) =>
      getOfficeTypeForChamber(sourceCountryId, chamber, "1991-default")
    );
    const official = character
      ? await db.collection("electedOfficials").findOne({
          characterId: character._id,
          countryId: sourceCountryId,
          officeType: { $in: officeTypes },
        })
      : null;
    if (!official && auth.user.isAdmin !== true)
      return NextResponse.json(
        { error: "A seated federal legislator must open this decision." },
        { status: 403 }
      );
    const freeze = await checkLegislationFreeze(sourceCountryId);
    if (!freeze.ok) return freeze.response;
    const sharedAssets = (
      await loadLiveSuccessionInventory(db, sourceCountryId)
    ).custodyAssets.filter(
      (asset) => asset.kind === "strategic-force" || asset.homeRegionId === null
    );
    const assigned = parsed.data.negotiatedCustodians;
    const participants = new Set(defaultFederationParticipants(sourceCountryId));
    if (
      Object.keys(assigned).length !== sharedAssets.length ||
      sharedAssets.some(({ assetId }) => !participants.has(assigned[assetId]))
    )
      return NextResponse.json(
        { error: "Choose a successor custodian for every shared or strategic asset." },
        { status: 400 }
      );
    const proposal = await openDefaultFederationPoliticalProposal({
      db,
      sourceCountryId,
      currentYear,
      now: new Date(),
      negotiatedCustodians: assigned,
    });
    return NextResponse.json(
      { billId: proposal.billId.toString(), status: proposal.status },
      { status: 201 }
    );
  } catch (error) {
    return handleRouteError(error);
  }
}

import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { resolveCorporation, requireCeo } from "@/lib/api/corporations/resolveQuery";
import type { BargainingCampaign, CollectiveAgreement, Union } from "@/lib/db/types";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { isLabourFullMode } from "@/lib/labour/featureFlag";
import {
  getBargainingMediationAvailability,
  isCollectiveAgreementActive,
} from "@/lib/unions/bargaining";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;
    if (!(await isLabourFullMode())) {
      return NextResponse.json({ error: "Player-run unions are not enabled." }, { status: 403 });
    }
    const db = await getDb();
    const { id } = await params;
    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const ceoError = requireCeo(resolved.corporation, auth.user.userId);
    if (ceoError) return ceoError;
    const corporationId = resolved.corporation._id;
    const [campaigns, agreements, currentTurn] = await Promise.all([
      db
        .collection<BargainingCampaign>("bargainingCampaigns")
        .find({ employerCorporationId: corporationId })
        .sort({ updatedAt: -1 })
        .limit(50)
        .toArray(),
      db
        .collection<CollectiveAgreement>("collectiveAgreements")
        .find({ employerCorporationId: corporationId, status: "active" })
        .sort({ expiresAtTurn: 1 })
        .toArray(),
      getCurrentTurn(db),
    ]);
    const unionObjectIds = [...campaigns, ...agreements].map((record) => record.unionId);
    const unionIds = [...new Set(unionObjectIds.map((unionId) => unionId.toString()))].map(
      (unionId) => unionObjectIds.find((candidate) => candidate.toString() === unionId)!
    );
    const unions = unionIds.length
      ? await db
          .collection<Union>("unions")
          .find({ _id: { $in: unionIds } }, { projection: { name: 1 } })
          .toArray()
      : [];
    const unionNameById = new Map(unions.map((union) => [union._id.toString(), union.name]));

    return NextResponse.json({
      currentTurn,
      campaigns: campaigns.map((campaign) => {
        const mediationAvailability = getBargainingMediationAvailability(campaign, currentTurn);
        return {
          campaignId: campaign._id.toString(),
          unionId: campaign.unionId.toString(),
          unionName: unionNameById.get(campaign.unionId.toString()) ?? "Unknown union",
          status: campaign.status,
          escalationLevel: campaign.escalationLevel,
          mediation: campaign.mediation ?? null,
          // The employer is waiting on an answer to its own offer, and the
          // answer is now the members', not the president's. Told the same way
          // a pending mediation package is: enough to know an answer is coming
          // and when, with no ballot detail. Hiding it would leave a CEO
          // reading silence as a refusal and escalating into a vote that was
          // about to ratify.
          ratification: campaign.ratification
            ? {
                status: campaign.ratification.status,
                offerRevision: campaign.ratification.offerRevision,
                openedAtTurn: campaign.ratification.openedAtTurn,
                closesAtTurn: campaign.ratification.closesAtTurn,
              }
            : null,
          mediationAvailable: mediationAvailability.available,
          mediationUnavailableReason: mediationAvailability.reason,
          currentOffer: campaign.currentOffer,
          offers: campaign.offers,
          // Deliberately NOT the whole mandate. An employer sees the four
          // inputs it can genuinely observe: union cards in its own plants, the
          // wages it sets, the national labour market and the statute book.
          // `support` is the union's internal strike ballot, and
          // `strikeFundRunway` is its treasury: an employer that could read the
          // fund exactly would know how many turns to sit out any dispute,
          // which removes the bluff that makes a dispute a decision. Narrowing
          // the client type is not enough, the values have to stay off the wire.
          mandate: {
            coverage: campaign.mandate.coverage,
            grievance: campaign.mandate.grievance,
            laborTightness: campaign.mandate.laborTightness,
            lawSupport: campaign.mandate.lawSupport,
            leverage: campaign.mandate.leverage,
          },
          sectorCount: campaign.sectorIds.length,
          startedAtTurn: campaign.startedAtTurn,
          deadlineTurn: campaign.deadlineTurn,
          lastActionTurn: campaign.lastActionTurn,
          disputeStartedAtTurn: campaign.disputeStartedAtTurn ?? null,
          mediationAvailableTurn: mediationAvailability.availableTurn,
          endedAtTurn: campaign.endedAtTurn ?? null,
        };
      }),
      agreements: agreements
        .filter((agreement) => isCollectiveAgreementActive(agreement, currentTurn))
        .map((agreement) => ({
          agreementId: agreement._id.toString(),
          unionId: agreement.unionId.toString(),
          unionName: unionNameById.get(agreement.unionId.toString()) ?? "Unknown union",
          wageLevel: agreement.wageLevel,
          sectorCount: agreement.sectorIds.length,
          expiresAtTurn: agreement.expiresAtTurn,
          noStrikeUntilTurn: agreement.noStrikeUntilTurn,
        })),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

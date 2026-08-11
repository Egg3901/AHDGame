import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { getAuthUserWithCharacter, type AuthUserWithCharacter } from "@/lib/auth"; // Optional auth — intentionally uses getAuthUserWithCharacter()
import { handleRouteError } from "@/lib/api/errors";
import { ObjectId } from "mongodb";
import type { Campaign, Character, NPP, PoliticalParty } from "@/lib/db/types";
import { resolveElectionRouteParam } from "@/lib/elections/electionParamResolution";
import { getEffectiveUpgradeCost, getMaintenanceCost } from "@/lib/campaigns/upgradeCosts";
import { calculateCampaignIncome } from "@/lib/campaigns/income";
import { calculateMaintenanceCosts } from "@/lib/campaigns/maintenance";
import { campaignAnchorToLocal, getCampaignCurrency } from "@/lib/campaigns/campaignCurrency";
import { isCampaignUpgradeGeneralPhase } from "@/lib/elections/phases";
import { getGameTime } from "@/lib/time/gameTime";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/elections/[id]/campaigns — Returns all campaigns for an election, with fog-of-war filtering based on viewer role.
// Auth: public
// Errors: 400, 404
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { id: electionId } = await params;

    // Auth is optional - public can view with fog of war
    let user: AuthUserWithCharacter | null = null;
    try {
      user = await getAuthUserWithCharacter();
    } catch {
      // User not authenticated or no character - that's okay, they'll see fog of war
    }

    const db = await getDb();

    const resolved = await resolveElectionRouteParam(db, electionId);
    if (!resolved.ok) {
      if (resolved.reason === "invalid_id") {
        return NextResponse.json({ error: "Invalid election ID" }, { status: 400 });
      }
      return NextResponse.json({ error: "Election not found" }, { status: 404 });
    }

    const electionOid = resolved.election._id;
    // Exclude archived campaigns (primary losers / withdrawn) from this active
    // list surface — they are retained for history but should not appear
    // alongside the candidates still in the race. The direct /campaign/[id]
    // page still renders an archived campaign for its owner.
    const campaigns = await db
      .collection<Campaign>("campaigns")
      .find({ electionId: electionOid, status: { $ne: "archived" } })
      .toArray();

    // Fix C1: Batch fetch all candidates and managers to avoid N+1 queries
    const characterIds: ObjectId[] = [];
    const nppIds: ObjectId[] = [];
    const managerIds: ObjectId[] = [];
    const partyIds = new Set<number>();
    const electionCountryId = resolved.election.countryId ?? "US";
    // Campaign treasuries are stored in local currency; the budget / upgrade-cost
    // constants are anchor. Campaign funds are decoupled from live forex — the
    // preview localizes at the frozen base INITIAL_RATES scale (campaignAnchorToLocal,
    // inside formatCampaignForViewer) so it matches what campaignTurn and
    // upgradeCampaign actually credit/charge (never the live exchangeRates).
    const campaignCurrencyCode = getCampaignCurrency(electionCountryId);

    // General-phase upgrade surcharge + per-race-family scalar are computed once
    // for the whole list (one election → one phase). The cost preview must match
    // the upgrade gate so the "Upgrade" button only enables when it will pass.
    const electionType = resolved.election.electionType;
    const gameTime = await getGameTime();
    const isGeneralPhase = isCampaignUpgradeGeneralPhase(
      resolved.election,
      gameTime.currentTurn,
      gameTime
    );

    for (const campaign of campaigns) {
      if (campaign.candidateIsNPP) {
        nppIds.push(campaign.candidateId);
      } else {
        characterIds.push(campaign.candidateId);
      }
      if (campaign.managerCharacterId) {
        managerIds.push(campaign.managerCharacterId);
      }
      const partyId = Number(campaign.party);
      if (Number.isInteger(partyId) && partyId > 0) {
        partyIds.add(partyId);
      }
    }

    // Batch fetch all required data in parallel
    const [characters, npps, managers, parties] = await Promise.all([
      characterIds.length > 0
        ? db
            .collection<Character>("characters")
            .find({ _id: { $in: characterIds } })
            .toArray()
        : Promise.resolve([]),
      nppIds.length > 0
        ? db
            .collection<NPP>("npps")
            .find({ _id: { $in: nppIds } })
            .toArray()
        : Promise.resolve([]),
      managerIds.length > 0
        ? db
            .collection<Character>("characters")
            .find({ _id: { $in: managerIds } })
            .toArray()
        : Promise.resolve([]),
      partyIds.size > 0
        ? db
            .collection<PoliticalParty>("politicalParties")
            .find(
              { countryId: electionCountryId, sequentialId: { $in: Array.from(partyIds) } },
              { projection: { sequentialId: 1, name: 1, abbreviation: 1, color: 1 } }
            )
            .toArray()
        : Promise.resolve([]),
    ]);

    // Create lookup maps for O(1) access
    const candidateMap = new Map<string, Character | NPP>();
    characters.forEach((c) => candidateMap.set(c._id.toString(), c));
    npps.forEach((n) => candidateMap.set(n._id.toString(), n));

    const managerMap = new Map<string, Character>();
    managers.forEach((m) => managerMap.set(m._id.toString(), m));

    const partyMap = new Map<string, PoliticalParty>();
    parties.forEach((p) => partyMap.set(p.sequentialId.toString(), p));

    // Format campaigns using lookup maps
    const formatted = campaigns
      .map((campaign) =>
        formatCampaignForViewer(
          campaign,
          user,
          candidateMap,
          managerMap,
          partyMap,
          electionCountryId,
          campaignCurrencyCode,
          electionType,
          isGeneralPhase
        )
      )
      .filter((c) => c !== null); // Filter out campaigns with missing candidates

    return NextResponse.json({ campaigns: formatted });
  } catch (error) {
    return handleRouteError(error);
  }
}

function formatCampaignForViewer(
  campaign: Campaign,
  user: AuthUserWithCharacter | null,
  candidateMap: Map<string, Character | NPP>,
  managerMap: Map<string, Character>,
  partyMap: Map<string, PoliticalParty>,
  electionCountryId: string,
  campaignCurrencyCode: string,
  electionType: string | undefined,
  isGeneralPhase: boolean
): Record<string, unknown> | null {
  // Look up candidate from map with null safety
  if (!campaign.candidateId) {
    console.error(`Campaign ${campaign._id} has no candidateId`);
    return null;
  }

  const candidate = candidateMap.get(campaign.candidateId.toString());
  if (!candidate) {
    // Candidate has been deleted - skip this campaign
    console.warn(`Campaign ${campaign._id} has missing candidate ${campaign.candidateId}`);
    return null;
  }

  // Look up manager info from map if assigned
  let managerName: string | null = null;
  if (campaign.managerCharacterId) {
    const manager = managerMap.get(campaign.managerCharacterId.toString());
    managerName = manager?.name || null;
  }

  // Determine viewer access level
  const isManager = user && campaign.managerId?.equals(new ObjectId(user.userId));
  // `isNominee` means the viewer's ACTIVE character is this campaign's candidate.
  // The "Your Campaign" panel uses this to pick the correct row — not isExact,
  // because admins get isExact=true on every row.
  const isNominee =
    user?.hasCharacter && user.character && campaign.candidateId.equals(user.character._id);
  const isAdmin = user?.isAdmin || false;
  const canSeeExact = isManager || isNominee || isAdmin;
  // isMine separates "I am the candidate" from "I can see full details" (admin).
  const isMine = Boolean(isManager || isNominee);

  // Determine fog level - must match both party AND country to avoid cross-country collisions
  const isSameParty =
    user?.character?.party === campaign.party &&
    (user?.character?.countryId ?? "US") === electionCountryId;
  const fogData = isSameParty ? campaign.partyFogOfWar : campaign.publicFogOfWar;

  // Use sequentialId for candidate URL (falls back to ObjectId if not set)
  const candidateSeqId = candidate.sequentialId?.toString() ?? campaign.candidateId.toString();
  const partyDoc = partyMap.get(campaign.party);

  const base = {
    id: campaign._id.toString(),
    candidateId: candidateSeqId,
    candidateName: candidate?.name || "Unknown",
    candidateIsNPP: campaign.candidateIsNPP,
    party: campaign.party,
    partyName: partyDoc?.name ?? formatPartyLabel(campaign.party),
    partyColor: partyDoc?.color ?? null,

    currencyCode: campaignCurrencyCode,
    funds: campaign.funds ?? 0,
    actions: campaign.actions ?? 0,

    levels: canSeeExact
      ? {
          fundraising: campaign.fundraisingLevel ?? 0,
          oppositionResearch: campaign.oppositionResearchLevel ?? 0,
          groundGame: campaign.groundGameLevel ?? 0,
          mediaSpending: campaign.mediaSpendingLevel ?? 0,
        }
      : {
          fundraising: fogData?.fundraisingLevel ?? 0,
          oppositionResearch: fogData?.oppositionResearchLevel ?? 0,
          groundGame: fogData?.groundGameLevel ?? 0,
          mediaSpending: fogData?.mediaSpendingLevel ?? 0,
        },
    isExact: canSeeExact,
    isMine,
    fogLastUpdated:
      !canSeeExact && fogData?.lastUpdated ? fogData.lastUpdated.toISOString() : undefined,

    managerId: campaign.managerId?.toString() || null,
    managerName,

    oppositionTargetId: campaign.oppositionTargetId?.toString() || null,
    oppositionTargetName: campaign.oppositionTargetName,
  };

  // Add privileged data for manager/nominee/admin
  if (canSeeExact) {
    // Per-race-family budget scalar applies to income + maintenance (parity with
    // getCampaignDetail) so non-presidential budgets aren't shown at presidential scale.
    const income = calculateCampaignIncome(campaign, electionType);
    const maintenance = calculateMaintenanceCosts(campaign, electionType);

    // Fix I2: Use getMaintenanceCost helper for consistency
    const groundGameMaintenance = getMaintenanceCost(
      "groundGame",
      campaign.groundGameLevel,
      electionType
    );
    const mediaSpendingMaintenance = getMaintenanceCost(
      "mediaSpending",
      campaign.mediaSpendingLevel,
      electionType
    );

    // Campaign funds are decoupled from live forex — localize anchor
    // income/maintenance/upgrade costs at the frozen base INITIAL_RATES scale.
    const toLocal = (anchor: number) => campaignAnchorToLocal(anchor, electionCountryId);
    const privilegedData = {
      ...base,
      activityHistory: campaign.activityHistory.map((a) => ({
        ...a,
        timestamp: a.timestamp.toISOString(),
      })),
      budget: {
        // funds + cumulative totals are already local in storage.
        income: {
          total: toLocal(income),
        },
        expenses: {
          groundGameMaintenance: toLocal(groundGameMaintenance),
          mediaSpendingMaintenance: toLocal(mediaSpendingMaintenance),
          total: toLocal(maintenance),
        },
        netIncome: toLocal(income) - toLocal(maintenance),
        cumulative: {
          totalGenerated: campaign.totalFundsGenerated,
          totalSpent: campaign.totalFundsSpent,
          actionsGenerated: campaign.totalActionsGenerated,
          actionsSpent: campaign.totalActionsSpent,
        },
      },
      nextUpgradeCosts: {
        fundraising: localizeCostFunds(
          getEffectiveUpgradeCost(
            "fundraising",
            campaign.fundraisingLevel + 1,
            electionType,
            isGeneralPhase
          ),
          toLocal
        ),
        oppositionResearch: localizeCostFunds(
          getEffectiveUpgradeCost(
            "oppositionResearch",
            campaign.oppositionResearchLevel + 1,
            electionType,
            isGeneralPhase
          ),
          toLocal
        ),
        groundGame: localizeCostFunds(
          getEffectiveUpgradeCost(
            "groundGame",
            campaign.groundGameLevel + 1,
            electionType,
            isGeneralPhase
          ),
          toLocal
        ),
        mediaSpending: localizeCostFunds(
          getEffectiveUpgradeCost(
            "mediaSpending",
            campaign.mediaSpendingLevel + 1,
            electionType,
            isGeneralPhase
          ),
          toLocal
        ),
      },
    };
    return privilegedData;
  }

  return base;
}

/** Convert an anchor upgrade-cost entry's funds/maintenance to local currency. */
function localizeCostFunds(
  cost: {
    level: number;
    funds: number;
    actions: number;
    effect: string;
    maintenance?: number;
  } | null,
  toLocal: (anchor: number) => number
): { level: number; funds: number; actions: number; effect: string; maintenance?: number } | null {
  if (!cost) return null;
  return {
    ...cost,
    funds: toLocal(cost.funds),
    ...(cost.maintenance != null ? { maintenance: toLocal(cost.maintenance) } : {}),
  };
}

function formatPartyLabel(party: string): string {
  const trimmed = party.trim();
  if (!trimmed) return "Unknown party";
  if (/^\d+$/.test(trimmed)) return `Party ${trimmed}`;
  return trimmed
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

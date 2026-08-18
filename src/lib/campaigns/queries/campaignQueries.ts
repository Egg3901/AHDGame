import type { AuthUserWithCharacter } from "@/lib/auth";
import { calculateCampaignActions } from "@/lib/campaigns/actions";
import { calculateCampaignIncome } from "@/lib/campaigns/income";
import { isCampaignEligibleElection } from "@/lib/campaigns/isCampaignEligible";
import { calculateMaintenanceCosts } from "@/lib/campaigns/maintenance";
import {
  getEffectiveUpgradeCost,
  getMaintenanceCost,
  getTreeMaintenanceCost,
  getCampaignFamilyScalar,
} from "@/lib/campaigns/upgradeCosts";
import { isCampaignUpgradeGeneralPhase } from "@/lib/elections/phases";
import { getGameTime } from "@/lib/time/gameTime";
import {
  SUPPORT_RALLY_FULL_VALUE,
  SUPPORT_RALLY_ACTION_COST,
  SUPPORT_RALLY_TOUR_TICK_ACTION_COST,
} from "@/lib/electionEngine/electionFormulaFactors";
import { isCampaignManagerUser, isCampaignNomineeUser } from "@/lib/campaigns/access";
import { getCampaignCopyForElection } from "@/lib/campaigns/raceFamilyCopy";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import {
  campaignAnchorToLocal,
  campaignLocalRate,
  getCampaignCurrency,
} from "@/lib/campaigns/campaignCurrency";
import type { CampaignData } from "@/lib/campaigns/dto/campaignView";
import { buildOpsTrees } from "@/lib/campaigns/dto/campaignView";
import { notFound } from "@/lib/api/errors";
import { buildActiveVisibleNppEndorsementFilter } from "@/lib/nppEndorsements";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import type {
  Campaign,
  CampaignActivity,
  Character,
  Election,
  ElectionCandidate,
  NPP,
  NPPEndorsement,
  PoliticalParty,
} from "@/lib/db/types";
import { ObjectId, type Db } from "mongodb";

export interface CampaignListItem {
  id: string;
  candidateName: string;
  /**
   * Election type of this campaign (e.g. "president", "house", "senate").
   * Used by surfaces like the Nation dropdown that want to gate the
   * Campaign Manager link to specific race families (presidential only
   * for the v1 dashboard).
   */
  electionType: string;
}

export interface ViewerCampaigns {
  myCampaign: CampaignListItem | null;
  partyCampaign: CampaignListItem | null;
}

export async function getCampaignDetail(
  db: Db,
  campaignId: ObjectId,
  user: AuthUserWithCharacter | null
): Promise<CampaignData> {
  const campaign = await db.collection<Campaign>("campaigns").findOne({ _id: campaignId });
  if (!campaign) {
    throw notFound("Campaign not found");
  }

  // candidate / manager / election are independent of one another once the
  // campaign is known — fetch them as one parallel group rather than three
  // serial round-trips.
  const [candidate, manager, election] = await Promise.all([
    campaign.candidateIsNPP
      ? db.collection<NPP>("npps").findOne({ _id: campaign.candidateId })
      : db.collection<Character>("characters").findOne({ _id: campaign.candidateId }),
    campaign.managerCharacterId
      ? db.collection<Character>("characters").findOne({ _id: campaign.managerCharacterId })
      : Promise.resolve(null),
    db.collection<Election>("elections").findOne({ _id: campaign.electionId }),
  ]);
  if (!candidate) {
    throw notFound("Campaign candidate not found");
  }
  const managerName = manager?.name ?? null;

  const isIneligible = !election || !isCampaignEligibleElection(election);
  if (isIneligible && !user?.isAdmin) {
    throw notFound("Campaign not found");
  }

  const isManager = user ? isCampaignManagerUser(campaign, user.userId) : false;
  const isAdmin = user?.isAdmin || false;
  const electionCountryId = election?.countryId ?? "US";
  // isNominee, the FX rate, and party-treasury access are mutually independent —
  // resolve them as one parallel group. Campaign treasury is local; income /
  // maintenance / upgrade-cost constants are anchor, so the rate + currency
  // localize them for display.
  // Campaign funds are decoupled from live forex — the budget/cost preview uses
  // the frozen base INITIAL_RATES scale (via campaignAnchorToLocal) so it matches
  // what campaignTurn and upgradeCampaign actually credit/charge (never the live
  // exchangeRates).
  const campaignCurrencyCode = getCampaignCurrency(electionCountryId);
  const campaignRate = campaignLocalRate(electionCountryId); // frozen base rate, for the fxRate payload field
  const toLocal = (anchor: number) => campaignAnchorToLocal(anchor, electionCountryId);
  const [isNominee, partyTreasuryAccess] = await Promise.all([
    user
      ? isCampaignNomineeUser(db, campaign, user.userId, user.character?._id ?? null)
      : Promise.resolve(false),
    getPartyTreasuryAccess(db, campaign, election, user),
  ]);
  const canSeeExact = isManager || isNominee || isAdmin;
  const isSameParty =
    user?.character?.party === campaign.party &&
    (user?.character?.countryId ?? "US") === electionCountryId;
  const accessLevel: "owner" | "party" | "public" = canSeeExact
    ? "owner"
    : isSameParty
      ? "party"
      : "public";
  const fogData = isSameParty ? campaign.partyFogOfWar : campaign.publicFogOfWar;

  const base: CampaignData = {
    id: campaign._id.toString(),
    electionId: campaign.electionId.toString(),
    candidateId: campaign.candidateId.toString(),
    candidateName: candidate.name || "Unknown",
    candidateIsNPP: campaign.candidateIsNPP,
    party: campaign.party,
    accessLevel,
    isArchived: campaign.status === "archived",
    currencyCode: campaignCurrencyCode,
    fxRate: campaignRate,
    campaignStrength: campaign.campaignStrength ?? 0,
    funds: canSeeExact ? campaign.funds : undefined,
    actions: canSeeExact ? campaign.actions : undefined,
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
    managerId: campaign.managerId?.toString() || null,
    managerName,
    oppositionTargetId: canSeeExact ? campaign.oppositionTargetId?.toString() || null : null,
    oppositionTargetName: canSeeExact ? campaign.oppositionTargetName : null,
    fogLastUpdated:
      !canSeeExact && fogData?.lastUpdated ? fogData.lastUpdated.toISOString() : undefined,
    electionInfo: election
      ? {
          state: election.state,
          electionType: election.electionType,
          cycle: election.cycle,
          senateClass: election.senateClass ?? null,
          electionYear: election.electionYear ?? null,
          isEnded: election.status === "completed",
        }
      : null,
    ...(partyTreasuryAccess ? { partyTreasuryAccess } : {}),
  };

  if (!canSeeExact) {
    return base;
  }

  // Per-race-family budget scalar applies to income, maintenance, and
  // upgrade costs. `election?.electionType` may be undefined for legacy
  // rows without an election link — the helpers fall back to neutral 1.0×.
  const electionType = election?.electionType;
  // General-phase upgrade surcharge (×1.5 on funds + actions) must be reflected
  // in the cost preview so the "Upgrade" button only enables when the gate will
  // accept it. SSOT shared with the gate — see isCampaignUpgradeGeneralPhase.
  const gameTime = await getGameTime();
  const isGeneralPhase = isCampaignUpgradeGeneralPhase(election, gameTime.currentTurn, gameTime);
  const income = calculateCampaignIncome(campaign, electionType);
  const maintenance = calculateMaintenanceCosts(campaign, electionType);
  // Budget-panel split. Strategic Operations v2: read the tree's per-lever
  // maintenance (starter + branches, less any maintenance-reduction branch);
  // legacy rows fall back to the old linear-level maintenance.
  const groundGameMaintenance = campaign.groundGameTree?.starter
    ? getTreeMaintenanceCost("groundGame", campaign.groundGameTree, electionType)
    : getMaintenanceCost("groundGame", campaign.groundGameLevel, electionType);
  const mediaSpendingMaintenance = campaign.mediaSpendingTree?.starter
    ? getTreeMaintenanceCost("mediaSpending", campaign.mediaSpendingTree, electionType)
    : getMaintenanceCost("mediaSpending", campaign.mediaSpendingLevel, electionType);
  // playerEndorsements.candidateId is keyed by the electionCandidates row
  // _id (not campaign.candidateId, which is the character/NPP identity id —
  // see ticket #868), so resolve the row once and join on it. A character
  // can have more than one row per election (e.g. withdrew and re-entered
  // under a different party) — prefer the active one, matching what the
  // ownSupport/suspension panel below expects, but fall back to any row so
  // the endorsement count still reflects a withdrawn candidate's real
  // endorsements (matching pre-#868 behavior).
  const candidateRowCandidates = await db
    .collection<ElectionCandidate>("electionCandidates")
    .find({
      electionId: campaign.electionId,
      characterId: campaign.candidateId,
    })
    .toArray();
  const candidateRow =
    candidateRowCandidates.find((row) => row.status === "active") ??
    candidateRowCandidates[0] ??
    null;
  const [nppEndorsementCount, playerEndorsementCount] = await Promise.all([
    db.collection<NPPEndorsement>("nppEndorsements").countDocuments(
      buildActiveVisibleNppEndorsementFilter({
        electionId: campaign.electionId,
        candidateId: campaign.candidateId,
      })
    ),
    candidateRow
      ? db.collection("playerEndorsements").countDocuments({
          electionId: campaign.electionId,
          candidateId: candidateRow._id,
          isActive: true,
        })
      : Promise.resolve(0),
  ]);
  const endorsementCount = nppEndorsementCount + playerEndorsementCount;
  // Baseline mirrors the turn engine (campaignTurn.ts): max(baseActionsPerTurn, 4),
  // NOT the calculateCampaignActions default of 1 — otherwise the panel understates
  // the real per-turn gain.
  const gameConfigForActions = await db
    .collection<{ _id: string; baseActionsPerTurn?: number }>("gameConfig")
    .findOne({ _id: "default" }, { projection: { baseActionsPerTurn: 1 } });
  const playerBaseActions = Math.max(gameConfigForActions?.baseActionsPerTurn ?? 4, 4);
  const grossActionsPerTurn = calculateCampaignActions(endorsementCount, playerBaseActions);
  // Rally-tour tick drains actions every turn (campaignTurn.ts subtracts it from the
  // same $inc). Populated in the owner block below once we know the tour state; the
  // headline perTurn is reported NET of it so the panel matches the balance movement.
  let rallyTourActionDrain = 0;

  // Phase B — own-candidate Support snapshot for the rally panel. Only
  // populated for owner-access viewers (fog-of-war). NPP campaigns get
  // ownSupport set to undefined — NPPs don't have a rally surface.
  let ownSupport: CampaignData["ownSupport"] = undefined;
  let campaignSuspended = false;
  let suspendedAt: string | null = null;
  let endorsedCandidate: CampaignData["endorsedCandidate"] = null;
  let endorsementTargetWithdrawn = false;
  let suspendEndorse: CampaignData["suspendEndorse"] = undefined;
  if (!campaign.candidateIsNPP) {
    if (candidateRow && candidateRow.status === "active") {
      const currentTurn = await getCurrentTurn(db);
      const scalar = getCampaignFamilyScalar(electionType);
      const pendingDripTotal = Array.isArray(candidateRow.supportAccrual)
        ? candidateRow.supportAccrual.reduce(
            (sum, entry) => sum + entry.amountPerTurn * entry.turnsRemaining,
            0
          )
        : 0;
      ownSupport = {
        support: typeof candidateRow.support === "number" ? candidateRow.support : 50,
        pendingDripTotal,
        rallyTourActive: candidateRow.rallyTourActive === true,
        rallyFiredThisTurn:
          typeof candidateRow.lastRallyTurn === "number" &&
          candidateRow.lastRallyTurn >= currentTurn,
        rallyFullValue: SUPPORT_RALLY_FULL_VALUE * scalar,
        rallyOneShotActionCost: Math.ceil(SUPPORT_RALLY_ACTION_COST * scalar),
        rallyTourTickActionCost: Math.ceil(SUPPORT_RALLY_TOUR_TICK_ACTION_COST * scalar),
      };

      // An active rally tour ticks every turn IF the campaign can afford it (same
      // guard as campaignTurn.ts), draining actions and offsetting the endorsement
      // gain — which is why a maxed-out tourer sees a "stuck" action count.
      if (ownSupport.rallyTourActive && campaign.actions >= ownSupport.rallyTourTickActionCost) {
        rallyTourActionDrain = ownSupport.rallyTourTickActionCost;
      }

      campaignSuspended = candidateRow.campaignSuspended === true;
      suspendedAt = candidateRow.suspendedAt?.toISOString() ?? null;
      endorsementTargetWithdrawn = candidateRow.endorsementTargetWithdrawnAt != null;
      if (candidateRow.endorsedElectionCandidateId) {
        const endorsedRow = await db
          .collection<ElectionCandidate>("electionCandidates")
          .findOne(
            { _id: candidateRow.endorsedElectionCandidateId },
            { projection: { _id: 1, characterName: 1 } }
          );
        if (endorsedRow) {
          endorsedCandidate = {
            id: endorsedRow._id.toString(),
            name: endorsedRow.characterName,
          };
        }
      }

      const isPresidentialGeneral =
        election?.electionType === "president" &&
        isGeneralPhase &&
        election.status === "active" &&
        !campaignSuspended;
      if (isPresidentialGeneral) {
        const isNominee = await isCampaignNomineeUser(
          db,
          campaign,
          user?.userId ?? "",
          user?.character?._id ?? null
        );
        if (isNominee || isAdmin) {
          const targets = await db
            .collection<ElectionCandidate>("electionCandidates")
            .find(
              {
                electionId: campaign.electionId,
                status: "active",
                _id: { $ne: candidateRow._id },
              },
              { projection: { _id: 1, characterName: 1, party: 1 } }
            )
            .toArray();
          suspendEndorse = {
            eligible: targets.length > 0,
            targets: targets.map((target) => ({
              id: target._id.toString(),
              name: target.characterName,
              party: target.party,
            })),
          };
        }
      }
    }
  }

  return {
    ...base,
    ...(ownSupport ? { ownSupport } : {}),
    ...(campaignSuspended
      ? {
          campaignSuspended: true,
          suspendedAt,
          endorsedCandidate,
          endorsementTargetWithdrawn,
        }
      : {}),
    ...(suspendEndorse ? { suspendEndorse } : {}),
    activityHistory: campaign.activityHistory.map((entry: CampaignActivity) => ({
      ...entry,
      timestamp: entry.timestamp.toISOString(),
    })),
    budget: {
      // income / maintenance are anchor constants; funds is stored local.
      // Localize the per-turn figures so the budget panel matches the balance.
      income: { total: toLocal(income) },
      expenses: {
        groundGameMaintenance: toLocal(groundGameMaintenance),
        mediaSpendingMaintenance: toLocal(mediaSpendingMaintenance),
        total: toLocal(maintenance),
      },
      netIncome: toLocal(income) - toLocal(maintenance),
      actions: {
        endorsementCount,
        perTurn: grossActionsPerTurn - rallyTourActionDrain,
        grossPerTurn: grossActionsPerTurn,
        baseline: playerBaseActions,
        rallyTourDrain: rallyTourActionDrain,
      },
      cumulative: {
        totalGenerated: campaign.totalFundsGenerated,
        totalSpent: campaign.totalFundsSpent,
        actionsGenerated: campaign.totalActionsGenerated,
        actionsSpent: campaign.totalActionsSpent,
      },
    },
    nextUpgradeCosts: {
      fundraising: localizeUpgradeCostFunds(
        getEffectiveUpgradeCost(
          "fundraising",
          campaign.fundraisingLevel + 1,
          electionType,
          isGeneralPhase
        ),
        toLocal
      ),
      oppositionResearch: localizeUpgradeCostFunds(
        getEffectiveUpgradeCost(
          "oppositionResearch",
          campaign.oppositionResearchLevel + 1,
          electionType,
          isGeneralPhase
        ),
        toLocal
      ),
      groundGame: localizeUpgradeCostFunds(
        localizeGroundGameEffect(
          getEffectiveUpgradeCost(
            "groundGame",
            campaign.groundGameLevel + 1,
            electionType,
            isGeneralPhase
          ),
          election
        ),
        toLocal
      ),
      mediaSpending: localizeUpgradeCostFunds(
        getEffectiveUpgradeCost(
          "mediaSpending",
          campaign.mediaSpendingLevel + 1,
          electionType,
          isGeneralPhase
        ),
        toLocal
      ),
    },
    opsTrees: buildOpsTrees(campaign, electionType, isGeneralPhase, toLocal),
  };
}

/**
 * Localize an upgrade-cost entry's anchor `funds` (and `maintenance`, if set)
 * into the campaign's local currency. `actions` and `effect` are unchanged —
 * actions aren't currency and the effect string is an approximate label.
 */
function localizeUpgradeCostFunds(
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

/**
 * Phase 5.5 — replace the hardcoded "+X% in swing states" effect string
 * with race-family-aware wording ("swing counties" for senate / governor,
 * "swing precincts" for house / state senate). Mechanic unchanged; copy
 * localizes per the D5 adapter pattern.
 *
 * Returns null untouched so the upstream `|| null` ladder still flows
 * cleanly when the campaign is at max ground-game level. The return type
 * widens `effect` to plain `string` (vs the literal-typed `UPGRADE_COSTS`
 * entries) so the localized copy fits — DTO consumers only need
 * `{ funds, actions, effect, ... }`, not the literal types.
 */
function localizeGroundGameEffect(
  cost: {
    level: number;
    funds: number;
    actions: number;
    effect: string;
    maintenance?: number;
  } | null,
  election: Election | null
): { level: number; funds: number; actions: number; effect: string; maintenance?: number } | null {
  if (!cost || !election) return cost;
  const copy = getCampaignCopyForElection(election);
  if (copy.family === "president") return cost;
  const match = /^\+(\d+)%/.exec(cost.effect);
  if (!match) return cost;
  const percent = Number(match[1]);
  return { ...cost, effect: copy.groundGameEffect(percent) };
}

export async function getViewerCampaigns(
  db: Db,
  user: AuthUserWithCharacter | null
): Promise<ViewerCampaigns> {
  if (!user?.hasCharacter || !user.character) {
    return { myCampaign: null, partyCampaign: null };
  }

  const userOid = new ObjectId(user.userId);
  const party = user.character.party;
  const characterCountryId = user.character.countryId;
  const ownedCharacterIds = await db
    .collection<Character>("characters")
    .find({ userId: userOid }, { projection: { _id: 1 } })
    .toArray();
  const candidateIds = ownedCharacterIds.map((character) => character._id);
  const countryElections = await db
    .collection<Election>("elections")
    .find(
      { countryId: characterCountryId },
      { projection: { _id: 1, countryId: 1, electionType: 1 } }
    )
    .toArray();
  const eligibleCountryElectionIds = countryElections
    .filter((election) => isCampaignEligibleElection(election))
    .map((election) => election._id);

  const myCampaignDoc = await db.collection<Campaign>("campaigns").findOne({
    status: { $ne: "archived" },
    $or: [
      { managerId: userOid },
      ...(candidateIds.length > 0 ? [{ candidateId: { $in: candidateIds } }] : []),
    ],
  });

  let partyCampaignDoc: Campaign | null = null;
  if (party && party !== "independent" && eligibleCountryElectionIds.length > 0) {
    partyCampaignDoc = await db.collection<Campaign>("campaigns").findOne({
      party,
      status: { $ne: "archived" },
      electionId: { $in: eligibleCountryElectionIds },
      _id: { $ne: myCampaignDoc?._id ?? new ObjectId() },
    });
  }

  const electionIds = [myCampaignDoc?.electionId, partyCampaignDoc?.electionId].filter(
    (id): id is ObjectId => id !== undefined && id !== null
  );
  const eligibleElectionCountryMap = new Map<string, string>();
  const eligibleElectionTypeMap = new Map<string, string>();
  if (electionIds.length > 0) {
    const elections = await db
      .collection<Election>("elections")
      .find(
        { _id: { $in: electionIds } },
        { projection: { _id: 1, countryId: 1, electionType: 1 } }
      )
      .toArray();
    for (const election of elections) {
      if (isCampaignEligibleElection(election)) {
        eligibleElectionCountryMap.set(election._id.toString(), election.countryId ?? "");
        eligibleElectionTypeMap.set(election._id.toString(), election.electionType ?? "");
      }
    }
  }

  const myCampaign =
    myCampaignDoc && eligibleElectionCountryMap.has(myCampaignDoc.electionId.toString())
      ? myCampaignDoc
      : null;
  const partyCampaignCountry =
    partyCampaignDoc && eligibleElectionCountryMap.get(partyCampaignDoc.electionId.toString());
  const partyCampaign =
    partyCampaignDoc && partyCampaignCountry && partyCampaignCountry === characterCountryId
      ? partyCampaignDoc
      : null;

  async function getCandidateName(campaign: Campaign): Promise<string> {
    const collectionName = campaign.candidateIsNPP ? "npps" : "characters";
    const doc = await db
      .collection<Character | NPP>(collectionName)
      .findOne({ _id: campaign.candidateId }, { projection: { name: 1 } });
    return doc?.name || "Unknown";
  }

  return {
    myCampaign: myCampaign
      ? {
          id: myCampaign._id.toString(),
          candidateName: await getCandidateName(myCampaign),
          electionType: eligibleElectionTypeMap.get(myCampaign.electionId.toString()) ?? "",
        }
      : null,
    partyCampaign: partyCampaign
      ? {
          id: partyCampaign._id.toString(),
          candidateName: await getCandidateName(partyCampaign),
          electionType: eligibleElectionTypeMap.get(partyCampaign.electionId.toString()) ?? "",
        }
      : null,
  };
}

async function getPartyTreasuryAccess(
  db: Db,
  campaign: Campaign,
  election: Election | null,
  user: AuthUserWithCharacter | null
): Promise<CampaignData["partyTreasuryAccess"] | undefined> {
  if (!user?.hasCharacter || !election || !Number.isFinite(Number(campaign.party))) {
    return undefined;
  }

  const ownedCharIds = await db
    .collection<Character>("characters")
    .find({ userId: new ObjectId(user.userId) }, { projection: { _id: 1 } })
    .toArray();
  const ownedIds = ownedCharIds.map((character) => character._id);
  if (ownedIds.length === 0) {
    return undefined;
  }

  const candidateParty = await db.collection<PoliticalParty>("politicalParties").findOne(
    {
      sequentialId: Number(campaign.party),
      countryId: election.countryId,
      $or: [
        { chairId: { $in: ownedIds } },
        { viceChairId: { $in: ownedIds } },
        { treasurerId: { $in: ownedIds } },
      ],
    },
    {
      projection: {
        sequentialId: 1,
        name: 1,
        treasury: 1,
        chairId: 1,
        viceChairId: 1,
        treasurerId: 1,
      },
    }
  );
  if (!candidateParty) {
    return undefined;
  }

  const role: "chair" | "viceChair" | "treasurer" = ownedIds.some((id) =>
    candidateParty.chairId?.equals(id)
  )
    ? "chair"
    : ownedIds.some((id) => candidateParty.viceChairId?.equals(id))
      ? "viceChair"
      : "treasurer";

  return {
    partyId: candidateParty.sequentialId,
    partyName: candidateParty.name,
    role,
    treasury: candidateParty.treasury ?? 0,
    currencyCode:
      COUNTRY_CURRENCY_MAP[election.countryId as keyof typeof COUNTRY_CURRENCY_MAP] ?? "USD",
  };
}

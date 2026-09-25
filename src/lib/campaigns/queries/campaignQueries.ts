import { loadCampaignCurrencyRates } from "@/lib/campaigns/campaignCurrency";
import type { AuthUserWithCharacter } from "@/lib/auth";
import { campaignActionsPerTurn } from "@/lib/campaigns/actions";
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
import {
  isCampaignManagerUser,
  isCampaignNomineeUser,
  isCampaignRunningMateUser,
  legacyManagersAsList,
} from "@/lib/campaigns/access";
import { presidentialRulesetFor } from "@/lib/elections/presidentialRuleset";
import { buildCampaignStatePresence } from "@/lib/elections/campaignStatePresence";
import { getCampaignCopyForElection } from "@/lib/campaigns/raceFamilyCopy";
import { getSeedCurrencyCode } from "@/lib/constants/currencies";
import { getGameStatePresetOrDefault } from "@/lib/db/collections/gameState";
import {
  campaignAnchorToLocal,
  campaignLocalRate,
  getCampaignCurrency,
} from "@/lib/campaigns/campaignCurrency";
import type { CampaignData, CampaignBriefing } from "@/lib/campaigns/dto/campaignView";
import { buildOpsTrees } from "@/lib/campaigns/dto/campaignView";
import {
  buildCashRunway,
  buildCoalitionWeakness,
  buildDelegatePath,
  buildTippingPath,
} from "@/lib/campaigns/briefing";
import { getDelegateMajority, resolvePartyFamily } from "@/lib/constants/primaryCalendar";
import { loadApportionment } from "@/lib/elections/apportionment";
import { notFound } from "@/lib/api/errors";
import { buildActiveVisibleNppEndorsementFilter } from "@/lib/nppEndorsements";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import type {
  Campaign,
  CampaignActivity,
  Character,
  Election,
  ElectionCandidate,
  ElectionVoteTally,
  NPP,
  NPPEndorsement,
  PlayerEndorsement,
  PoliticalParty,
} from "@/lib/db/types";
import { ObjectId, type Db } from "mongodb";
import { loadOppositionTargets } from "@/lib/campaigns/oppositionTargets";

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

  // Resolve every appointed manager (multi-manager, up to MAX_CAMPAIGN_MANAGERS)
  // to character id + name. Folds in the legacy single-manager pair so old
  // campaigns render identically. One `$in` fetch for all of them.
  const managerCharIds = (campaign.managers ?? legacyManagersAsList(campaign)).map(
    (m) => m.characterId
  );
  const managerChars = managerCharIds.length
    ? await db
        .collection<Character>("characters")
        .find({ _id: { $in: managerCharIds } }, { projection: { _id: 1, name: 1 } })
        .toArray()
    : [];
  const managerNameById = new Map(managerChars.map((c) => [c._id.toString(), c.name]));
  const managers = managerCharIds.map((id) => ({
    characterId: id.toString(),
    name: managerNameById.get(id.toString()) ?? "Unknown",
  }));

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
  // the frozen world-seeded currency basis (via campaignAnchorToLocal) so it matches
  // what campaignTurn and upgradeCampaign actually credit/charge (never the live
  // exchangeRates).
  const [campaignRates, detailPreset] = await Promise.all([
    loadCampaignCurrencyRates(db),
    // One route-path read: euro members preview in EUR, matching what
    // upgradeCampaign/donateToCampaign actually charge.
    getGameStatePresetOrDefault(db),
  ]);
  const campaignCurrencyCode = getCampaignCurrency(electionCountryId, detailPreset);
  const campaignRate = campaignLocalRate(electionCountryId, campaignRates, detailPreset); // frozen base rate, for the fxRate payload field
  const toLocal = (anchor: number) =>
    campaignAnchorToLocal(anchor, electionCountryId, campaignRates, detailPreset);
  const [isNominee, isRunningMate, partyTreasuryAccess] = await Promise.all([
    user
      ? isCampaignNomineeUser(db, campaign, user.userId, user.character?._id ?? null)
      : Promise.resolve(false),
    user
      ? isCampaignRunningMateUser(db, campaign, user.userId, user.character?._id ?? null)
      : Promise.resolve(false),
    getPartyTreasuryAccess(db, campaign, election, user, detailPreset),
  ]);
  // A running mate gets an owner-level VIEW of the ticket campaign (canSeeExact),
  // but a narrower action set, enforced client-side and by the server route
  // gates, not here.
  const canSeeExact = isManager || isNominee || isAdmin || isRunningMate;
  const isSameParty =
    user?.character?.party === campaign.party &&
    (user?.character?.countryId ?? "US") === electionCountryId;
  const accessLevel: "owner" | "party" | "public" = canSeeExact
    ? "owner"
    : isSameParty
      ? "party"
      : "public";
  const fogData = isSameParty ? campaign.partyFogOfWar : campaign.publicFogOfWar;

  // Running-mate surrogate pool snapshot (presidential tickets only). The cap
  // comes from the race's frozen ruleset; a fresh/unrefilled pool degrades to
  // the cap so the panel never shows an empty pool before the first daily reset.
  const presRuleset =
    election?.electionType === "president" ? presidentialRulesetFor(election) : null;
  const runningMateSurrogate =
    isRunningMate && presRuleset
      ? {
          actionsRemaining:
            campaign.runningMateSurrogateActionsRemaining ?? presRuleset.vpSurrogateActionCap,
          cap: presRuleset.vpSurrogateActionCap,
          resetHint: "Resets daily at midnight Eastern Time.",
        }
      : undefined;

  // Named running mate, for the campaign board's ticket block. Presidential
  // tickets only, so down-ballot races skip both lookups entirely.
  let runningMateName: string | null = null;
  let runningMateCharacterId: string | null = null;
  if (election?.electionType === "president") {
    const ticketRow = await db
      .collection<ElectionCandidate>("electionCandidates")
      .findOne(
        { electionId: campaign.electionId, characterId: campaign.candidateId },
        { projection: { runningMateId: 1 } }
      );
    if (ticketRow?.runningMateId) {
      const mate = await db
        .collection<{ name?: string }>("characters")
        .findOne({ _id: ticketRow.runningMateId }, { projection: { name: 1 } });
      if (mate?.name) {
        runningMateName = mate.name;
        runningMateCharacterId = ticketRow.runningMateId.toString();
      }
    }
  }

  // Where the candidate is campaigning, and the controls to move there. Only
  // for the candidate themself: travelling and camping spend that character's
  // own actions, which is why both routes gate on the authenticated character
  // rather than on manager access.
  const viewerIsCandidate =
    user?.character != null && user.character._id.toString() === campaign.candidateId.toString();
  const statePresence = viewerIsCandidate
    ? await buildCampaignStatePresence(db, { election, character: user!.character! })
    : null;

  const base: CampaignData = {
    id: campaign._id.toString(),
    electionId: campaign.electionId.toString(),
    candidateId: campaign.candidateId.toString(),
    candidateName: candidate.name || "Unknown",
    candidateIsNPP: campaign.candidateIsNPP,
    party: campaign.party,
    accessLevel,
    countryId: electionCountryId,
    isArchived: campaign.status === "archived",
    isRunningMate,
    ...(runningMateSurrogate ? { runningMateSurrogate } : {}),
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
    managers,
    // Only the nominee (or an admin) may change managers, and not on an
    // archived campaign. Managers themselves cannot appoint further managers.
    canAppointManagers: (isNominee || isAdmin) && campaign.status !== "archived",
    runningMateName,
    statePresence,
    runningMateCharacterId,
    oppositionTargetId: canSeeExact ? campaign.oppositionTargetId?.toString() || null : null,
    oppositionTargetName: canSeeExact ? campaign.oppositionTargetName : null,
    ...(canSeeExact && election
      ? {
          oppositionTargets: await loadOppositionTargets(
            db,
            election,
            campaign.candidateId,
            await getGameTime()
          ),
        }
      : {}),
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
  // under a different party). `candidateRow` prefers the active one and falls
  // back to any row, which is what the ownSupport/suspension panel below
  // expects. Endorsements do NOT take that fallback: see `activeCandidateRow`.
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
  /**
   * Endorsements join on the ACTIVE row only, with no fallback.
   *
   * The turn engine resolves rows with `status: "active"` and nothing else, so
   * a withdrawn candidate earns nothing from endorsements held on the old row.
   * Falling back here would promise a withdrawn presidential candidate actions
   * the turn will not pay, which is the mismatch this desk exists to avoid.
   */
  const activeCandidateRow = candidateRowCandidates.find((row) => row.status === "active") ?? null;
  // Read the endorsing rows rather than counting them: the ledger's
  // endorsements tab lists the same rows the action panel counts, so one read
  // serves both and the list cannot disagree with the number beside it.
  const [nppEndorsementRows, playerEndorsementRows] = await Promise.all([
    db
      .collection<NPPEndorsement>("nppEndorsements")
      .find(
        buildActiveVisibleNppEndorsementFilter({
          electionId: campaign.electionId,
          candidateId: campaign.candidateId,
        }),
        { projection: { nppName: 1, createdAt: 1 } }
      )
      .toArray(),
    activeCandidateRow
      ? db
          .collection<PlayerEndorsement>("playerEndorsements")
          .find(
            {
              electionId: campaign.electionId,
              candidateId: activeCandidateRow._id,
              isActive: true,
            },
            { projection: { characterName: 1, createdAt: 1 } }
          )
          .toArray()
      : Promise.resolve([]),
  ]);
  const endorsements: CampaignData["endorsements"] = [
    ...nppEndorsementRows.map((row) => ({
      kind: "npp" as const,
      name: row.nppName || "Unknown politician",
      since: row.createdAt?.toISOString() ?? null,
    })),
    ...playerEndorsementRows.map((row) => ({
      kind: "player" as const,
      name: row.characterName || "Unknown candidate",
      since: row.createdAt?.toISOString() ?? null,
    })),
    // Newest first. Rows without a timestamp sort last rather than jumping to
    // the top, which is where an empty string would put them.
  ].sort((a, b) => (b.since ?? "").localeCompare(a.since ?? ""));
  const nppEndorsementCount = nppEndorsementRows.length;
  const playerEndorsementCount = playerEndorsementRows.length;
  const endorsementCount = nppEndorsementCount + playerEndorsementCount;
  // The desk must promise exactly what the turn engine pays, so it reads the
  // same four endorsement sources and hands them to the same function rather
  // than re-deriving the rule. Re-deriving it is what let this panel advertise
  // 15 actions a turn against an engine crediting 8.
  const [gameConfigForActions, governorEndorsementCount, executiveEndorsementCount] =
    await Promise.all([
      db
        .collection<{ _id: string; baseActionsPerTurn?: number }>("gameConfig")
        .findOne({ _id: "default" }, { projection: { baseActionsPerTurn: 1 } }),
      db.collection("governorEndorsements").countDocuments({
        electionId: campaign.electionId,
        candidateId: campaign.candidateId,
        isActive: true,
      }),
      db.collection("executiveEndorsements").countDocuments({
        electionId: campaign.electionId,
        candidateId: campaign.candidateId,
        isActive: true,
      }),
    ]);
  const grossActionsPerTurn = campaignActionsPerTurn({
    nppEndorsements: nppEndorsementCount,
    playerEndorsements: playerEndorsementCount,
    governorEndorsements: governorEndorsementCount,
    executiveEndorsements: executiveEndorsementCount,
    isPresidential: election?.electionType === "president",
    candidateIsNPP: campaign.candidateIsNPP === true,
    baseActionsPerTurn: gameConfigForActions?.baseActionsPerTurn ?? 4,
  });
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

  const opsTrees = buildOpsTrees(campaign, electionType, isGeneralPhase, toLocal);
  const nextUpgradeCosts: CampaignData["nextUpgradeCosts"] = {
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
  };

  // Campaign-room briefing (owner-only, read-only). Composes data the engine /
  // tally already produced — never recomputes vote math. Skipped for archived
  // campaigns (no live plan to brief). Delegate/tipping paths and coalition
  // weakness are presidential concepts read off the tally; the cash runway
  // applies to any race.
  /**
   * Whether the turn will move this campaign at all. `campaignTurn.ts`
   * `continue`s past an archived campaign and past a suspended one before it
   * computes income, charges maintenance or credits actions, so the desk has to
   * report zero rather than a rate that will never be applied.
   */
  const accruesNothing = campaign.status === "archived" || campaignSuspended;

  const briefing =
    campaign.status === "archived"
      ? undefined
      : await buildBriefing({
          db,
          campaign,
          election,
          candidateRow,
          isGeneralPhase,
          // Zero when suspended, like every other per-turn figure: the runway
          // built from this is a countdown to insolvency, and a campaign the
          // turn engine skips is neither earning nor burning.
          netPerTurn: accruesNothing ? 0 : toLocal(income) - toLocal(maintenance),
        });

  return {
    ...base,
    ...(ownSupport ? { ownSupport } : {}),
    ...(briefing ? { briefing } : {}),
    ...(campaignSuspended
      ? {
          campaignSuspended: true,
          suspendedAt,
          endorsedCandidate,
          endorsementTargetWithdrawn,
        }
      : {}),
    ...(suspendEndorse ? { suspendEndorse } : {}),
    endorsements,
    // Guarded for documents written before the field existed; every insert
    // path sets it to [] now.
    activityHistory: (campaign.activityHistory ?? []).map((entry: CampaignActivity) => ({
      ...entry,
      timestamp: entry.timestamp.toISOString(),
    })),
    budget: {
      // income / maintenance are anchor constants; funds is stored local.
      // Localize the per-turn figures so the budget panel matches the balance.
      //
      // A dormant campaign moves on none of these. The turn engine `continue`s
      // past both archived and suspended campaigns BEFORE it computes income,
      // charges maintenance or credits actions, so every per-turn figure here
      // is zero rather than a rate the turn will never apply. Reporting money
      // at full value beside zero actions would put two contradictory rates in
      // the same row.
      income: { total: accruesNothing ? 0 : toLocal(income) },
      expenses: {
        groundGameMaintenance: accruesNothing ? 0 : toLocal(groundGameMaintenance),
        mediaSpendingMaintenance: accruesNothing ? 0 : toLocal(mediaSpendingMaintenance),
        total: accruesNothing ? 0 : toLocal(maintenance),
      },
      netIncome: accruesNothing ? 0 : toLocal(income) - toLocal(maintenance),
      actions: {
        endorsementCount,
        perTurn: accruesNothing ? 0 : grossActionsPerTurn - rallyTourActionDrain,
        grossPerTurn: accruesNothing ? 0 : grossActionsPerTurn,
        // What the campaign would earn with no endorsements at all, from the
        // same rule that produced the figure above. Zeroed alongside the rest
        // when suspended: a baseline beside a zero rate is the contradiction
        // the zeroing exists to avoid.
        baseline: accruesNothing
          ? 0
          : campaignActionsPerTurn({
              nppEndorsements: 0,
              playerEndorsements: 0,
              governorEndorsements: 0,
              executiveEndorsements: 0,
              isPresidential: election?.electionType === "president",
              candidateIsNPP: campaign.candidateIsNPP === true,
              baseActionsPerTurn: gameConfigForActions?.baseActionsPerTurn ?? 4,
            }),
        rallyTourDrain: rallyTourActionDrain,
      },
      cumulative: {
        totalGenerated: campaign.totalFundsGenerated,
        totalSpent: campaign.totalFundsSpent,
        actionsGenerated: campaign.totalActionsGenerated,
        actionsSpent: campaign.totalActionsSpent,
      },
    },
    nextUpgradeCosts,
    opsTrees,
  };
}

/**
 * Build the owner-only campaign-room briefing. Pure composition of already-stored
 * data: the presidential tally (delegate map / per-unit votes / factor ledger),
 * the just-built ops-tree view, and the localized next-upgrade costs. Presidential
 * intel (path + coalition weakness) is loaded only for a president race with a
 * tally; every other campaign still gets its cash runway. No vote math is
 * recomputed anywhere here.
 */
async function buildBriefing(args: {
  db: Db;
  campaign: Campaign;
  election: Election | null;
  candidateRow: ElectionCandidate | null;
  isGeneralPhase: boolean;
  netPerTurn: number;
}): Promise<CampaignBriefing> {
  const { db, campaign, election, candidateRow, isGeneralPhase } = args;

  const cashRunway = buildCashRunway(campaign.funds, args.netPerTurn);
  let path: CampaignBriefing["path"];
  let coalitionWeakness: CampaignBriefing["coalitionWeakness"] = [];

  if (election?.electionType === "president") {
    const tally = await db
      .collection<ElectionVoteTally>("electionVoteTallies")
      .findOne({ electionId: campaign.electionId });
    if (tally) {
      // The tally / ledger / delegate map are keyed by the electionCandidate row
      // id, not the character identity id — resolve the owner's row id.
      const ownerTallyId = candidateRow?._id.toString() ?? null;

      // The whole field, so "weak" can mean a bucket the owner is losing rather
      // than merely a small one. Only the owner's own shares are emitted.
      coalitionWeakness = buildCoalitionWeakness(
        tally.factorLedger?.byCandidateNational,
        ownerTallyId
      );

      const gameState = await db
        .collection<{ _id: string; preset?: string; currentYear?: number }>("gameState")
        .findOne({ _id: "current" }, { projection: { preset: 1, currentYear: 1 } });
      const preset = gameState?.preset;

      if (isGeneralPhase) {
        const { electoralVoteUnits } = await loadApportionment(db, preset, gameState?.currentYear);
        const stateDocs = (await db
          .collection("states")
          .find({ countryId: election.countryId ?? "US" }, { projection: { _id: 1, name: 1 } })
          .toArray()) as unknown as Array<{ _id: string; name: string }>;
        const stateNameById: Record<string, string> = {};
        for (const s of stateDocs) stateNameById[s._id] = s.name;
        path = buildTippingPath({
          totalVotesByUnit: tally.totalVotesByUnit ?? {},
          evUnits: electoralVoteUnits,
          ownerTallyId,
          candidateIds: Object.keys(tally.candidateNames ?? {}),
          stateNameById,
        });
      } else {
        const party = await db
          .collection<PoliticalParty>("politicalParties")
          .findOne(
            { sequentialId: Number(campaign.party), countryId: election.countryId },
            { projection: { primaryCalendar: 1, economicPosition: 1 } }
          );
        const family = resolvePartyFamily(campaign.party, {
          primaryCalendar: party?.primaryCalendar ?? null,
          economicPosition: party?.economicPosition,
        });
        const needed = getDelegateMajority(family, preset);
        path = buildDelegatePath(
          tally.primaryDelegates?.[campaign.party],
          ownerTallyId,
          needed,
          tally.candidateNames ?? {}
        );
      }
    }
  }

  return {
    ...(path ? { path } : {}),
    cashRunway,
    coalitionWeakness,
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

  // This resolves a name and an election type for a nav link, so it has no use
  // for the activity array. A campaign now keeps 200 entries rather than 10.
  const campaignListProjection = { projection: { activityHistory: 0 } };

  const myCampaignDoc = await db.collection<Campaign>("campaigns").findOne(
    {
      status: { $ne: "archived" },
      $or: [
        { managerId: userOid },
        ...(candidateIds.length > 0 ? [{ candidateId: { $in: candidateIds } }] : []),
      ],
    },
    campaignListProjection
  );

  let partyCampaignDoc: Campaign | null = null;
  if (party && party !== "independent" && eligibleCountryElectionIds.length > 0) {
    partyCampaignDoc = await db.collection<Campaign>("campaigns").findOne(
      {
        party,
        status: { $ne: "archived" },
        electionId: { $in: eligibleCountryElectionIds },
        _id: { $ne: myCampaignDoc?._id ?? new ObjectId() },
      },
      campaignListProjection
    );
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
  user: AuthUserWithCharacter | null,
  preset?: string
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
    currencyCode: getSeedCurrencyCode(election.countryId, preset ?? ""),
  };
}

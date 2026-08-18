import * as Sentry from "@sentry/nextjs";
import { getDb } from "@/lib/mongodb";
import { ObjectId } from "mongodb";
import type { UpdateFilter } from "mongodb";
import type { Campaign, ElectionCandidate } from "@/lib/db/types";
import { calculateCampaignIncome } from "@/lib/campaigns/income";
import { calculateCampaignActions } from "@/lib/campaigns/actions";
import { calculateMaintenanceCosts } from "@/lib/campaigns/maintenance";
import { getCampaignFamilyScalar, getOpsBranchMagnitude } from "@/lib/campaigns/upgradeCosts";
import { getMediaFavPerTurn, getOppoDrainPerTurn } from "@/lib/campaigns/opsEffects";
import {
  SUPPORT_RALLY_FULL_VALUE,
  SUPPORT_RALLY_TOUR_TICK_ACTION_COST,
} from "@/lib/electionEngine/electionFormulaFactors";
import { buildRallyAccrualEntry } from "@/lib/turn/elections/supportAccrual";
import { computeAutoDowngrade } from "@/lib/campaigns/autoDowngrade";
import { calculateCampaignStrengthLeaderPullbacks } from "@/lib/campaigns/campaignStrength";
import { GOVERNOR_ENDORSEMENT_CAMPAIGN_ACTIONS } from "@/lib/constants/governorOffice";
import { isCampaignEligibleElection } from "@/lib/campaigns/isCampaignEligible";
import { selfHealMissingCampaigns } from "@/lib/campaigns/selfHealCampaigns";
import {
  campaignAnchorToLocal,
  campaignLocalRate,
  getCampaignCurrency,
} from "@/lib/campaigns/campaignCurrency";
import {
  PRIMARY_CAMPAIGN_TICK_CAP,
  PRIMARY_CAMPAIGN_NATIONAL_FAV_BONUS,
} from "@/lib/electionEngine/constants";
import { loadTxThresholds, emitTxBulk } from "@/lib/financialTxLog/emit";
import type { FinancialTxLogEntry } from "@/lib/db/types/financialTxLog";
import { buildActiveVisibleNppEndorsementFilter } from "@/lib/nppEndorsements";
import { logger } from "../observability/logger";

export interface CampaignTurnResults {
  campaignsProcessed: number;
  totalFundsGenerated: number;
  totalActionsGenerated: number;
  totalMaintenancePaid: number;
  campaignsAutoDowngraded: number;
}

export async function processCampaignTurn(turnNumber: number): Promise<CampaignTurnResults> {
  return Sentry.startSpan(
    { name: "turn.campaignTurn", op: "turn.phase", attributes: { turn: turnNumber } },
    async () => {
      const db = await getDb();

      let campaignsProcessed = 0;
      let totalFundsGenerated = 0;
      let totalActionsGenerated = 0;
      let totalMaintenancePaid = 0;
      let campaignsAutoDowngraded = 0;
      const fundraiseTxEntries: Omit<FinancialTxLogEntry, "_id" | "expiresAt" | "flagged">[] = [];

      try {
        // Self-heal backstop: guarantee every active player candidate in a
        // Campaign-eligible election has a live campaign before processing income /
        // maintenance. Repairs candidates left without a campaign by legacy entry
        // paths, seeded rosters, re-entry after archival, or an out-of-band wipe —
        // so the Campaign Manager never dead-ends on "Campaign not found".
        try {
          const healed = await selfHealMissingCampaigns(db, new Date());
          if (healed > 0) {
            console.log(`[Campaign Turn] Self-healed ${healed} missing campaign(s)`);
          }
        } catch (err) {
          logger.error("Campaign Turn", "Self-heal sweep failed", err);
        }

        // Campaign treasuries are stored in each campaign's local currency, but the
        // income / maintenance constants are anchor. Campaign funds are DECOUPLED
        // from live forex — conversion uses the frozen, preset-aware INITIAL_RATES
        // scale (campaignLocalRate / campaignAnchorToLocal), never the live
        // exchangeRates. This keeps income/cost ratios stable as markets drift.

        // Player's base actions-per-turn — used as the baseline for campaign action
        // generation so an active player rolls a correspondingly more active campaign.
        // Campaign pool is separate from the player's own action pool; endorsements
        // only boost this campaign pool, never the player's.
        const gameConfig = await db
          .collection<{ _id: string; baseActionsPerTurn?: number }>("gameConfig")
          .findOne({ _id: "default" });
        const playerBaseActions = Math.max(gameConfig?.baseActionsPerTurn ?? 4, 4);
        // NPPs get a smaller baseline since they don't have active piloting.
        const nppBaseActions = Math.max(1, Math.floor(playerBaseActions / 2));

        // Only process campaigns tied to elections that are still active — completed
        // elections should have had their campaigns deleted at resolution time, but
        // this filter is a defensive guard against any stragglers.
        const activeElections = await db
          .collection("elections")
          .find(
            { status: "active" },
            // Phase 5.5: countryId added so isCampaignEligibleElection can run
            // against the active election when deciding whether passive favorability
            // effects should fire (Phase 5.5 widened from president-only to all
            // US senate / governor / house / state-senate races).
            {
              projection: {
                _id: 1,
                endTime: 1,
                endTurn: 1,
                primaryEndTime: 1,
                primaryEndTurn: 1,
                electionType: 1,
                countryId: 1,
              },
            }
          )
          .toArray();
        const activeElectionIds = activeElections.map((e) => e._id);
        const electionDataMap = new Map(
          activeElections.map((e) => [
            e._id.toString(),
            {
              endTime: e.endTime as Date,
              endTurn: (e.endTurn as number | undefined) ?? null,
              primaryEndTime: (e.primaryEndTime as Date | undefined) ?? null,
              primaryEndTurn: (e.primaryEndTurn as number | undefined) ?? null,
              electionType: e.electionType as string,
              countryId: e.countryId,
            },
          ])
        );

        const campaigns = await db
          .collection<Campaign>("campaigns")
          .find({ electionId: { $in: activeElectionIds } })
          .toArray();

        // Strategic Operations v2 — incoming opposition-research shield.
        // A candidate defended by a campaign whose Media > Rapid Response
        // branch (mediaSpendingTree.c, effectType oppoShieldPct) is unlocked
        // takes reduced opposition-research favorability damage. Keyed by the
        // defended candidateId so the oppo-debuff step (below) can look it up
        // cross-campaign. Highest shield wins if a character somehow has two.
        const oppoShieldByCharacterId = new Map<string, number>();
        for (const c of campaigns) {
          const tree = c.mediaSpendingTree;
          if (!tree?.starter || tree.c <= 0) continue;
          const shield = getOpsBranchMagnitude("mediaSpending", "c", tree.c);
          const key = c.candidateId.toString();
          oppoShieldByCharacterId.set(key, Math.max(oppoShieldByCharacterId.get(key) ?? 0, shield));
        }

        // Batch-fetch travel + primary-campaign state from ElectionCandidate for all campaigns.
        // travelState is used during general-phase travel presence bonus; primaryCampaignState
        // and primaryCampaignTicks drive the primary-phase in-state bonus.
        const electionCandidateTravelMap = new Map<string, string | null>();
        const electionCandidatePrimaryMap = new Map<
          string,
          { primaryCampaignState: string | null; primaryCampaignTicks: number; _id: ObjectId }
        >();
        // B1.3 — per-candidate rally-tour state. Active tour means the
        // per-turn processor queues a fresh rally event for that candidate
        // every turn. Includes the current support so we can compute the
        // immediate bump synchronously.
        const electionCandidateRallyMap = new Map<
          string,
          { _id: ObjectId; rallyTourActive: boolean; support: number }
        >();
        const suspendedCampaignKeys = new Set<string>();
        if (campaigns.length > 0) {
          const candidatePairs = campaigns
            .filter((c) => !c.candidateIsNPP)
            .map((c) => ({ electionId: c.electionId, characterId: c.candidateId }));

          if (candidatePairs.length > 0) {
            const electionCandidateDocs = await db
              .collection<ElectionCandidate>("electionCandidates")
              .find({
                $or: candidatePairs.map((p) => ({
                  electionId: p.electionId,
                  characterId: p.characterId,
                  status: "active",
                })),
              })
              .project({
                _id: 1,
                electionId: 1,
                characterId: 1,
                travelState: 1,
                primaryCampaignState: 1,
                primaryCampaignTicks: 1,
                rallyTourActive: 1,
                support: 1,
                campaignSuspended: 1,
              })
              .toArray();

            for (const doc of electionCandidateDocs) {
              const key = `${doc.electionId.toString()}:${doc.characterId.toString()}`;
              if (doc.campaignSuspended) {
                suspendedCampaignKeys.add(key);
              }
              electionCandidateTravelMap.set(key, doc.travelState ?? null);
              electionCandidatePrimaryMap.set(key, {
                _id: doc._id,
                primaryCampaignState: doc.primaryCampaignState ?? null,
                primaryCampaignTicks: doc.primaryCampaignTicks ?? 0,
              });
              electionCandidateRallyMap.set(key, {
                _id: doc._id,
                rallyTourActive: doc.rallyTourActive === true,
                support: typeof doc.support === "number" ? doc.support : 50,
              });
            }
          }
        }

        const campaignStrengthPullbacks = calculateCampaignStrengthLeaderPullbacks(
          campaigns
            .filter((campaign) => {
              if (campaign.candidateIsNPP) return true;
              const key = `${campaign.electionId.toString()}:${campaign.candidateId.toString()}`;
              return !suspendedCampaignKeys.has(key);
            })
            .map((campaign) => ({
              id: campaign._id.toString(),
              electionId: campaign.electionId.toString(),
              campaignStrength: campaign.campaignStrength,
              status: campaign.status,
            }))
        );

        const now = new Date();
        const campaignOps: {
          updateOne: { filter: { _id: ObjectId }; update: UpdateFilter<Campaign> };
        }[] = [];
        /**
         * ElectionCandidate bulkWrite ops for incrementing primaryCampaignTicks
         * (capped at PRIMARY_CAMPAIGN_TICK_CAP). Accumulated alongside campaign
         * updates and flushed in a single bulkWrite at the end.
         */
        const candidateOps: {
          updateOne: { filter: { _id: ObjectId }; update: UpdateFilter<ElectionCandidate> };
        }[] = [];
        const passiveEffectsData: {
          campaign: Campaign;
          favorabilityChanges: Map<string, { collection: string; amount: number }>;
        }[] = [];

        // Bulk-fetch all candidates upfront to avoid N+1 queries
        const characterIds = campaigns.filter((c) => !c.candidateIsNPP).map((c) => c.candidateId);
        const nppIds = campaigns.filter((c) => c.candidateIsNPP).map((c) => c.candidateId);
        const [characterDocs, nppDocs] = await Promise.all([
          characterIds.length > 0
            ? db
                .collection("characters")
                .find({ _id: { $in: characterIds } })
                .toArray()
            : Promise.resolve([]),
          nppIds.length > 0
            ? db
                .collection("npps")
                .find({ _id: { $in: nppIds } })
                .toArray()
            : Promise.resolve([]),
        ]);
        const candidateMap = new Map<string, (typeof characterDocs)[number]>();
        for (const doc of characterDocs) candidateMap.set(doc._id.toString(), doc);
        for (const doc of nppDocs) candidateMap.set(doc._id.toString(), doc);

        // Batch-fetch endorsement counts to avoid N+1 in the loop
        const campaignElectionIds = campaigns.map((c) => c.electionId);
        const campaignCandidateIds = campaigns.map((c) => c.candidateId);

        // playerEndorsements.candidateId is the electionCandidates row _id, not
        // the character/NPP identity id campaigns key off (ticket #868). Resolve
        // each campaign's candidate row once so the aggregate below can join
        // correctly, then translate results back to the identity-id eKey space
        // shared with the NPP/governor/executive endorsement maps.
        const candidateRows = await db
          .collection<ElectionCandidate>("electionCandidates")
          .find({
            electionId: { $in: campaignElectionIds },
            characterId: { $in: campaignCandidateIds },
            status: "active",
          })
          .project<{ _id: ObjectId; electionId: ObjectId; characterId: ObjectId }>({
            _id: 1,
            electionId: 1,
            characterId: 1,
          })
          .toArray();
        const identityKeyByRowId = new Map(
          candidateRows.map((row) => [
            row._id.toString(),
            `${row.electionId.toString()}:${row.characterId.toString()}`,
          ])
        );
        const candidateRowIds = candidateRows.map((row) => row._id);

        const [
          nppEndorsementCounts,
          playerEndorsementCounts,
          governorEndorsementCounts,
          executiveEndorsementCounts,
        ] = await Promise.all([
          db
            .collection("nppEndorsements")
            .aggregate<{ _id: { electionId: ObjectId; candidateId: ObjectId }; count: number }>([
              {
                $match: buildActiveVisibleNppEndorsementFilter({
                  electionId: { $in: campaignElectionIds },
                  candidateId: { $in: campaignCandidateIds },
                }),
              },
              {
                $group: {
                  _id: { electionId: "$electionId", candidateId: "$candidateId" },
                  count: { $sum: 1 },
                },
              },
            ])
            .toArray(),
          candidateRowIds.length > 0
            ? db
                .collection("playerEndorsements")
                .aggregate<{ _id: { electionId: ObjectId; candidateId: ObjectId }; count: number }>(
                  [
                    {
                      $match: {
                        electionId: { $in: campaignElectionIds },
                        candidateId: { $in: candidateRowIds },
                        isActive: true,
                      },
                    },
                    {
                      $group: {
                        _id: { electionId: "$electionId", candidateId: "$candidateId" },
                        count: { $sum: 1 },
                      },
                    },
                  ]
                )
                .toArray()
            : Promise.resolve([]),
          db
            .collection("governorEndorsements")
            .aggregate<{ _id: { electionId: ObjectId; candidateId: ObjectId }; count: number }>([
              {
                $match: {
                  electionId: { $in: campaignElectionIds },
                  candidateId: { $in: campaignCandidateIds },
                  isActive: true,
                },
              },
              {
                $group: {
                  _id: { electionId: "$electionId", candidateId: "$candidateId" },
                  count: { $sum: 1 },
                },
              },
            ])
            .toArray(),
          db
            .collection("executiveEndorsements")
            .aggregate<{ _id: { electionId: ObjectId; candidateId: ObjectId }; count: number }>([
              {
                $match: {
                  electionId: { $in: campaignElectionIds },
                  candidateId: { $in: campaignCandidateIds },
                  isActive: true,
                },
              },
              {
                $group: {
                  _id: { electionId: "$electionId", candidateId: "$candidateId" },
                  count: { $sum: 1 },
                },
              },
            ])
            .toArray(),
        ]);

        const endorsementKey = (eId: ObjectId, cId: ObjectId) => `${eId}:${cId}`;
        const nppEndorsementMap = new Map(
          nppEndorsementCounts.map((e) => [
            endorsementKey(e._id.electionId, e._id.candidateId),
            e.count,
          ])
        );
        const playerEndorsementMap = new Map(
          playerEndorsementCounts
            .map((e): [string, number] | null => {
              const identityKey = identityKeyByRowId.get(e._id.candidateId.toString());
              return identityKey ? [identityKey, e.count] : null;
            })
            .filter((entry): entry is [string, number] => entry !== null)
        );
        const governorEndorsementMap = new Map(
          governorEndorsementCounts.map((e) => [
            endorsementKey(e._id.electionId, e._id.candidateId),
            e.count,
          ])
        );
        const executiveEndorsementMap = new Map(
          executiveEndorsementCounts.map((e) => [
            endorsementKey(e._id.electionId, e._id.candidateId),
            e.count,
          ])
        );

        for (const campaign of campaigns) {
          try {
            const candidateCollection = campaign.candidateIsNPP ? "npps" : "characters";
            const candidate = candidateMap.get(campaign.candidateId.toString());

            if (!candidate) {
              console.warn(
                `[Campaign Turn] Candidate ${campaign.candidateId} not found for campaign ${campaign._id}, skipping`
              );
              continue;
            }

            const suspendedKey = `${campaign.electionId.toString()}:${campaign.candidateId.toString()}`;
            if (suspendedCampaignKeys.has(suspendedKey)) {
              continue;
            }

            const electionData = electionDataMap.get(campaign.electionId.toString());
            /*
             * Final-stretch multiplier: all campaign passive effects double in the
             * last 4 turns of an election. This models the real-world "closing
             * argument" surge — GOTV calls, last-minute ads, and opposition drops
             * all intensify as polls approach closing. The window matches the vote
             * engine's 25% closing surge (`turnVoteWeight`) so passives and votes
             * intensify in lockstep.
             *
             * Turn-first (drift-immune) with a Date fallback: keying off `endTurn`
             * keeps the window aligned with the turn-based race resolution
             * (`currentTurn >= endTurn`) even when the game clock has drifted away
             * from the stale `endTime` projection stamped at spawn.
             */
            const seasonMultiplier = (() => {
              if (typeof electionData?.endTurn === "number") {
                return electionData.endTurn - turnNumber <= 4 ? 2 : 1;
              }
              if (!electionData?.endTime) return 1;
              const hoursRemaining = Math.ceil(
                (electionData.endTime.getTime() - now.getTime()) / (60 * 60 * 1000)
              );
              return hoursRemaining <= 4 ? 2 : 1;
            })();

            // Per-race-family budget scalar applies to income, maintenance, and
            // upgrade costs. Sourced from the pre-fetched electionDataMap so
            // there's no per-campaign DB hop. Unknown / undefined electionType
            // falls back to 1.0× via getCampaignFamilyScalar.
            const electionTypeForScalar = electionData?.electionType;
            // Anchor income; converted to the campaign's local currency for the
            // treasury write below. `fundsAnchorForCalc` lets the anchor-denominated
            // auto-downgrade math compare against the local-stored balance.
            const income = calculateCampaignIncome(campaign, electionTypeForScalar);
            const campaignCountryId = electionData?.countryId ?? "US";
            // Frozen base local rate — never the live exchangeRates.
            const campaignRate = campaignLocalRate(campaignCountryId);
            const fundsAnchorForCalc =
              campaignRate !== 1 ? campaign.funds / campaignRate : campaign.funds;

            // Look up pre-fetched endorsement counts
            const eKey = endorsementKey(campaign.electionId, campaign.candidateId);
            const nppEndorsementCount = nppEndorsementMap.get(eKey) ?? 0;
            const playerEndorsementCount = playerEndorsementMap.get(eKey) ?? 0;
            /*
             * Player endorsements only grant campaign actions for presidential races.
             * In lower-level races (governor, senate, house) endorsements are
             * primarily a social/favorability signal — they don't meaningfully
             * mobilise the national coalitions needed to convert endorsements into
             * ground-level canvassing actions. Presidential campaigns are different:
             * a high-profile player endorsement can unlock national volunteer networks.
             */
            const isPresidential = electionData?.electionType === "president";
            const effectivePlayerEndorsements = isPresidential ? playerEndorsementCount : 0;
            // Governor endorsements weigh more than a single NPP endorsement and
            // apply at sub-presidential races as a national campaign-action boost.
            // For presidential, the boost is intentionally NOT granted here — a
            // governor's presidential endorsement is state-scoped and applied as
            // an in-state vote multiplier in accumulatePresidentVoteTurn, not as
            // a national resource bump.
            const governorEndorsementCount = isPresidential
              ? 0
              : (governorEndorsementMap.get(eKey) ?? 0);
            // Executive (President / PM / Chancellor) endorsements use the same
            // weight as governor endorsements. The leader is also blocked from
            // endorsing the presidential race itself (server-side via the
            // endorseable-types allowlist), so no isPresidential gate is needed.
            const executiveEndorsementCount = executiveEndorsementMap.get(eKey) ?? 0;
            const baseline = campaign.candidateIsNPP ? nppBaseActions : playerBaseActions;
            const actions = calculateCampaignActions(
              nppEndorsementCount +
                effectivePlayerEndorsements +
                (governorEndorsementCount + executiveEndorsementCount) *
                  GOVERNOR_ENDORSEMENT_CAMPAIGN_ACTIONS,
              baseline
            );

            // Calculate maintenance costs at the campaign's current (pre-downgrade)
            // levels. Passive favorability effects below still use these levels —
            // the player paid for them this turn and gets one last gasp before the
            // auto-downgrade kicks in.
            const preDowngradeMaintenance = calculateMaintenanceCosts(
              campaign,
              electionTypeForScalar
            );

            /*
             * Auto-downgrade on insolvency: when projected funds (funds + income)
             * can't cover per-turn maintenance, drop the most expensive current-
             * level maintenance tier one step at a time until the campaign is
             * solvent (or both Ground Game and Media Spending hit level 0). This
             * prevents the silent unbounded bleed that previously let campaigns
             * drain tens of millions into the red via raw $inc with no floor.
             */
            const downgrade = computeAutoDowngrade(campaign, {
              funds: fundsAnchorForCalc,
              income,
              electionType: electionTypeForScalar,
            });
            const effectiveMaintenance =
              downgrade.downgrades.length > 0 ? downgrade.newMaintenance : preDowngradeMaintenance;
            // Convert anchor income / maintenance to the campaign's local currency
            // for the treasury write (funds is stored local).
            const incomeLocal = campaignAnchorToLocal(income, campaignCountryId);
            const maintenanceLocal = campaignAnchorToLocal(effectiveMaintenance, campaignCountryId);

            const campaignSet: Record<string, unknown> = { updatedAt: now };
            if (downgrade.downgrades.length > 0) {
              // setFields encodes branch demotions (`groundGameTree.a`) or legacy
              // level demotions (`mediaSpendingLevel`) — merge them verbatim.
              Object.assign(campaignSet, downgrade.setFields);
              campaignsAutoDowngraded++;
            }

            const campaignUpdate: UpdateFilter<Campaign> = {
              $inc: {
                funds: incomeLocal - maintenanceLocal,
                actions: actions,
                totalFundsGenerated: incomeLocal,
                totalActionsGenerated: actions,
                // A2 — money driver reads per-turn spend, not lifetime
                // balance. Maintenance is the "passive" portion of per-turn
                // spend; upgrade purchases (via campaignCommands.ts) add the
                // "active" portion. Reset to 0 each turn happens in the
                // resetCampaignSpendThisTurn turn-phase, after voteAccumulation.
                spendThisTurn: maintenanceLocal,
              },
              $set: campaignSet,
            };
            const campaignStrengthPullback =
              campaignStrengthPullbacks.get(campaign._id.toString()) ?? 0;
            if (campaignStrengthPullback > 0) {
              campaignUpdate.$inc = {
                ...((campaignUpdate.$inc ?? {}) as Record<string, number>),
                campaignStrength: -campaignStrengthPullback,
              };
            }

            if (downgrade.downgrades.length > 0) {
              const downgradeActivities: Campaign["activityHistory"][number][] =
                downgrade.downgrades.map((d) => ({
                  type: "downgrade" as const,
                  category: d.category,
                  newLevel: d.toLevel,
                  costFunds: 0,
                  costActions: 0,
                  reason: "insolvency" as const,
                  timestamp: now,
                  turnNumber,
                }));
              campaignUpdate.$push = {
                activityHistory: {
                  $each: downgradeActivities,
                  $slice: -10,
                },
              };
            }

            // B1.3 — rally-tour tick. If this candidate has rallyTourActive
            // and the campaign can afford one tick's action cost (pre-income
            // basis, consistent with the maintenance check), queue a fresh
            // rally accrual entry and apply the immediate Support bump.
            const tourKey = `${campaign.electionId.toString()}:${campaign.candidateId.toString()}`;
            const rallyState = electionCandidateRallyMap.get(tourKey);
            if (rallyState?.rallyTourActive && !campaign.candidateIsNPP) {
              const tourTickCost = Math.ceil(
                SUPPORT_RALLY_TOUR_TICK_ACTION_COST * getCampaignFamilyScalar(electionTypeForScalar)
              );
              if (campaign.actions >= tourTickCost) {
                const scaledR =
                  SUPPORT_RALLY_FULL_VALUE * getCampaignFamilyScalar(electionTypeForScalar);
                const { immediateBump, entry } = buildRallyAccrualEntry(scaledR);
                const nextSupport = Math.max(0, Math.min(100, rallyState.support + immediateBump));

                // Subtract the tour cost from the campaign's actions $inc
                // (effectively shifting the net income line by -tickCost).
                campaignUpdate.$inc = {
                  ...((campaignUpdate.$inc ?? {}) as Record<string, number>),
                  actions:
                    (((campaignUpdate.$inc ?? {}) as Record<string, number>).actions ?? 0) -
                    tourTickCost,
                };

                // Push the rally accrual + apply immediate Support bump to
                // the candidate row in one atomic update.
                candidateOps.push({
                  updateOne: {
                    filter: { _id: rallyState._id },
                    update: {
                      $set: { support: nextSupport },
                      $push: { supportAccrual: entry },
                    },
                  },
                });
              }
            }

            campaignOps.push({
              updateOne: {
                filter: { _id: campaign._id },
                update: campaignUpdate,
              },
            });

            // Accumulate fundraising tx entry for player campaigns
            if (!campaign.candidateIsNPP && income > 0) {
              const charName =
                typeof candidate.name === "string" ? candidate.name : String(candidate._id);
              fundraiseTxEntries.push({
                type: "fundraise_credit",
                turn: turnNumber,
                createdAt: now,
                subjectType: "character",
                subjectId: campaign.candidateId,
                subjectName: charName,
                amount: incomeLocal,
                currencyCode: getCampaignCurrency(electionData?.countryId ?? "US"),
                meta: { source: "fundraise", campaignId: String(campaign._id) },
              });
            }

            // Collect passive effects data
            const favorabilityChanges = new Map<string, { collection: string; amount: number }>();

            // Passive favorability effects (media, opposition research, travel presence,
            // primary in-state bonus) fire for any race where Campaign Manager is
            // eligible. Phase 5.5 widened eligibility from president-only to US
            // senate / governor / house / state senate — all of which run the same
            // upgrade levels and therefore should also see the passive effects fire.
            // Pure passive favorability still gates on travel presence + primary
            // in-state bonus separately below; those gate on isPresidential because
            // the underlying mechanics (national travel system, presidential primary
            // in-state bonus) are presidential-only by design.
            const applyCampaignPassives =
              electionData != null && isCampaignEligibleElection(electionData);

            // Media Spending: +0.5% favorability per level per turn (2× during final 4 hours).
            // Phase 5.5: applies to all Campaign-Manager-eligible races (president +
            // US senate / governor / house / stateSenate).
            // Strategic Operations v2: read favorability/turn from the media tree
            // (starter + Broadcast + Digital Ads), with legacy-level fallback.
            const mediaFavPerTurn = getMediaFavPerTurn(campaign);
            if (applyCampaignPassives && mediaFavPerTurn > 0) {
              const favorabilityBoost = mediaFavPerTurn * seasonMultiplier;
              const key = campaign.candidateId.toString();
              favorabilityChanges.set(key, {
                collection: candidateCollection,
                amount: favorabilityBoost,
              });
            }

            // Opposition Research: -0.5% opponent favorability per level per turn
            // (2× during final 4 hours). Phase 5.5: applies to all Campaign-Manager-
            // eligible races. Targeting still requires opposition research level > 0
            // and an oppositionTargetId — both are race-family-agnostic.
            // Strategic Operations v2: recurring drain from the oppo tree
            // (starter + Dossier, amplified by Counter-Intel), reduced by the
            // target's Rapid Response shield (cross-campaign, precomputed above).
            const oppoDrainPerTurn = getOppoDrainPerTurn(campaign);
            if (applyCampaignPassives && oppoDrainPerTurn > 0 && campaign.oppositionTargetId) {
              const key = campaign.oppositionTargetId.toString();
              const shield = oppoShieldByCharacterId.get(key) ?? 0;
              const favorabilityDebuff = -oppoDrainPerTurn * (1 - shield) * seasonMultiplier;
              favorabilityChanges.set(key, {
                collection: "unknown", // Will be determined when applying
                amount: favorabilityDebuff,
              });
            }

            // Travel Presence Bonus: +1.0% favorability/turn while campaigning in a state.
            // Phase 5.5 keeps this presidential-only — the travel system that records
            // candidate travelState only fires for presidential races (per the
            // existing PresidentialMapWithStateDetail / candidateTravelStates plumbing).
            // Senate / Gov / House / StateSenate campaigns don't have an equivalent
            // travel mechanic yet, so leaving this gated on isPresidential is correct.
            if (isPresidential && !campaign.candidateIsNPP) {
              const travelKey = `${campaign.electionId.toString()}:${campaign.candidateId.toString()}`;
              const travelState = electionCandidateTravelMap.get(travelKey);
              if (travelState) {
                const key = campaign.candidateId.toString();
                const existingEntry = favorabilityChanges.get(key);
                favorabilityChanges.set(key, {
                  collection: candidateCollection,
                  amount: (existingEntry?.amount ?? 0) + 1.0,
                });
              }
            }

            /*
             * Primary-phase campaigning bonus: presidential players camped in a state
             * during the primary (primaryEndTime not yet passed) get the same +1
             * favorability/turn as general-election travel, plus a ticking in-state
             * primary-score bonus that caps at PRIMARY_CAMPAIGN_TICK_CAP (5). The
             * tick bonus is consumed by primaryProjection (pre-stagger) and the
             * stagger-phase vote accumulator.
             */
            if (
              !campaign.candidateIsNPP &&
              electionData?.electionType === "president" &&
              // Still in the primary phase — turn-first (drift-immune) with Date fallback.
              (typeof electionData.primaryEndTurn === "number"
                ? turnNumber < electionData.primaryEndTurn
                : !!electionData.primaryEndTime &&
                  electionData.primaryEndTime.getTime() > now.getTime())
            ) {
              const primaryKey = `${campaign.electionId.toString()}:${campaign.candidateId.toString()}`;
              const primaryEntry = electionCandidatePrimaryMap.get(primaryKey);
              if (primaryEntry?.primaryCampaignState) {
                const key = campaign.candidateId.toString();
                const existingFav = favorabilityChanges.get(key);
                favorabilityChanges.set(key, {
                  collection: candidateCollection,
                  amount: (existingFav?.amount ?? 0) + PRIMARY_CAMPAIGN_NATIONAL_FAV_BONUS,
                });
                // Increment tick (capped at cap). Tick reset to 0 on state change
                // happens in the primary-campaign API route, not here.
                if (primaryEntry.primaryCampaignTicks < PRIMARY_CAMPAIGN_TICK_CAP) {
                  candidateOps.push({
                    updateOne: {
                      filter: { _id: primaryEntry._id },
                      update: { $inc: { primaryCampaignTicks: 1 } },
                    },
                  });
                }
              }
            }

            if (favorabilityChanges.size > 0) {
              passiveEffectsData.push({ campaign, favorabilityChanges });
            }

            // Update statistics
            campaignsProcessed++;
            totalFundsGenerated += incomeLocal;
            totalActionsGenerated += actions;
            totalMaintenancePaid += maintenanceLocal;
          } catch (error) {
            logger.error("Campaign Turn", `Error processing campaign ${campaign._id}`, error);
            // Continue processing other campaigns
          }
        }

        // Execute bulkWrite for campaigns
        if (campaignOps.length > 0) {
          await db.collection<Campaign>("campaigns").bulkWrite(campaignOps);
        }

        // Flush primaryCampaignTicks increments in one bulkWrite. The cap is
        // enforced at schedule-time above (only queue an op if current < cap),
        // so the stored value cannot exceed PRIMARY_CAMPAIGN_TICK_CAP.
        if (candidateOps.length > 0) {
          await db.collection<ElectionCandidate>("electionCandidates").bulkWrite(candidateOps);
        }

        // Apply passive effects using bulkWrite
        await applyPassiveEffectsBulk(passiveEffectsData, db);

        console.log(`[Turn] Campaign turn: processed ${campaignsProcessed} campaign(s)`);

        if (fundraiseTxEntries.length > 0) {
          const thresholds = await loadTxThresholds(db);
          void emitTxBulk(db, fundraiseTxEntries, thresholds);
        }

        return {
          campaignsProcessed,
          totalFundsGenerated,
          totalActionsGenerated,
          totalMaintenancePaid,
          campaignsAutoDowngraded,
        };
      } catch (error) {
        logger.error("Campaign Turn", "Fatal error fetching campaigns", error);
        throw error; // Re-throw fatal errors
      }
    }
  );
}

async function applyPassiveEffectsBulk(
  passiveEffectsData: {
    campaign: Campaign;
    favorabilityChanges: Map<string, { collection: string; amount: number }>;
  }[],
  db: ReturnType<typeof getDb> extends Promise<infer T> ? T : never
): Promise<void> {
  const buildClampedFavorabilityUpdate = (amount: number) => [
    {
      $set: {
        favorability: {
          $min: [100, { $max: [0, { $add: [{ $ifNull: ["$favorability", 0] }, amount] }] }],
        },
      },
    },
  ];

  // Aggregate all favorability changes by collection and target
  const characterUpdates = new Map<string, number>();
  const nppUpdates = new Map<string, number>();
  const unknownTargets = new Map<string, number>(); // For opposition targets

  for (const { campaign: _campaign, favorabilityChanges } of passiveEffectsData) {
    for (const [targetId, { collection, amount }] of favorabilityChanges.entries()) {
      if (collection === "characters") {
        characterUpdates.set(targetId, (characterUpdates.get(targetId) ?? 0) + amount);
      } else if (collection === "npps") {
        nppUpdates.set(targetId, (nppUpdates.get(targetId) ?? 0) + amount);
      } else if (collection === "unknown") {
        // Opposition targets - need to determine collection
        unknownTargets.set(targetId, (unknownTargets.get(targetId) ?? 0) + amount);
      }
    }
  }

  // Resolve unknown targets (opposition research targets) — bulk lookup
  if (unknownTargets.size > 0) {
    const unknownIds = [...unknownTargets.keys()].map((id) => new ObjectId(id));
    const foundChars = await db
      .collection("characters")
      .find({ _id: { $in: unknownIds } }, { projection: { _id: 1 } })
      .toArray();
    const charIdSet = new Set(foundChars.map((c) => c._id.toString()));
    for (const [targetId, amount] of unknownTargets.entries()) {
      if (charIdSet.has(targetId)) {
        characterUpdates.set(targetId, (characterUpdates.get(targetId) ?? 0) + amount);
      } else {
        nppUpdates.set(targetId, (nppUpdates.get(targetId) ?? 0) + amount);
      }
    }
  }

  // Build bulkWrite operations
  if (characterUpdates.size > 0) {
    const charOps = [...characterUpdates.entries()].map(([targetId, amount]) => ({
      updateOne: {
        filter: { _id: new ObjectId(targetId) },
        update: buildClampedFavorabilityUpdate(amount),
      },
    }));
    await db.collection("characters").bulkWrite(charOps);
  }

  if (nppUpdates.size > 0) {
    const nppOps = [...nppUpdates.entries()].map(([targetId, amount]) => ({
      updateOne: {
        filter: { _id: new ObjectId(targetId) },
        update: buildClampedFavorabilityUpdate(amount),
      },
    }));
    await db.collection("npps").bulkWrite(nppOps);
  }
}

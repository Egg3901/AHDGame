import { captureServerGameEvent } from "@/lib/analytics/serverPosthog";
import { type OrganizationCashContext } from "@/lib/internationalOrganizations/cashLedger";
import { ObjectId, type Db } from "mongodb";
import {
  getOrganizationLegislationCollection,
  getOrganizationProposalsCollection,
} from "@/lib/db/collections";
import {
  getMembers,
  loadOrganizationDef,
  recordOrgHistoryEvent,
} from "@/lib/internationalOrganizations/service";
import { applyOrganizationSanctions } from "@/lib/internationalOrganizations/sanctions";
import { payOrganizationAid } from "@/lib/internationalOrganizations/aid";
import { queueAidAlignmentPull } from "@/lib/alignment/commands/queueAidAlignment";
import {
  setOrganizationDuesRate,
  disburseFromOrganizationFund,
  localToUsd,
  resolveOrgFundCurrencyCountry,
} from "@/lib/internationalOrganizations/organizationFund";
import { getAgencyDef } from "@/lib/constants/orgAgencies";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getGdpAnchorRate, loadWorldPreset } from "@/lib/currency/gdpAnchorRate";
import { type OrgFoundingContext } from "@/lib/internationalOrganizations/founding";
import { getDirectiveDef } from "@/lib/constants/orgDirectives";
import { setOrganizationPosture } from "@/lib/internationalOrganizations/posture";
import { POSTURE_META } from "@/lib/constants/orgPosture";
import { getConflict } from "@/lib/db/collections/conflicts";
import { hasBillLifecycle } from "@/lib/legislature/hasBillLifecycle";
import { getHeadOfGovernmentCharacter } from "@/lib/api/headOfGovernment";
import { buildJoinConflictBill } from "@/lib/internationalOrganizations/commands/buildJoinConflictBill";
import { buildOrganizationWarDeclarationBills } from "@/lib/internationalOrganizations/commands/buildOrganizationWarDeclarationBills";
import { isConflictConcluded } from "@/lib/military/conflictLifecycle";
import {
  classifyWarEntry,
  assessWarEntryPoliticalPressure,
  enactImmediateWarEntry,
  loadCollectiveDefenseEntryBlocks,
  warEntryIsImmediate,
} from "@/lib/military/warEntryPolicy";
import type { OrganizationLegislation } from "@/lib/db/types/internationalOrganization";
import type { GovernmentFormation } from "@/lib/db/types/governmentFormation";
import type { NPP } from "@/lib/db/types";
import {
  planOrganizationWarDeclarationFromDb,
  type OrganizationWarPlanningContext,
} from "@/lib/internationalOrganizations/warDeclarationPlanning";
import { enactAutomaticOrganizationWar } from "@/lib/internationalOrganizations/enactAutomaticWarDeclaration";
import { loadPolicyHeadSponsors } from "@/lib/internationalOrganizations/policyHeadSponsors";

async function getPolicyHeadSponsor(
  db: Db,
  countryId: CountryId
): Promise<{ _id: ObjectId; name: string; party?: string; isNpp: boolean } | null> {
  const playerHead = await getHeadOfGovernmentCharacter(db, countryId);
  if (playerHead) return { ...playerHead, isNpp: false };

  const formation = await db
    .collection<GovernmentFormation>("governmentFormations")
    .findOne({ _id: countryId, status: "formed" });
  const headNppId = formation?.presidentNppId ?? formation?.pmNppId ?? null;
  if (!headNppId) return null;
  const npp = await db
    .collection<NPP>("npps")
    .findOne({ _id: headNppId }, { projection: { _id: 1, name: 1, party: 1 } });
  return npp ? { _id: npp._id, name: npp.name, party: npp.party, isNpp: true } : null;
}

export function countryName(countryId: string): string {
  return COUNTRY_CONFIGS[countryId as CountryId]?.name ?? countryId;
}

/**
 * Apply a resolution's on-passage effect. FTAs need no extra write — the tariff
 * override layer reads active `free_trade_agreement` rows directly. Sanctions
 * enact org-origin embargoes. Directive / aid_package / joint_statement effects
 * land in Phase 2-ii (metrics-engine + treasury integration).
 */
export async function applyResolutionEffect(
  db: Db,
  resolution: OrganizationLegislation,
  members: CountryId[],
  currentTurn: number,
  expiresTurn?: number,
  /**
   * The roster that can be ASKED TO LEGISLATE about this resolution: for
   * `join_conflict`, the legislating roll (player-enabled members plus, in
   * active mode, modelled members with a formed NPP government).
   *
   * Separate from `members`, which is every modelled member: an effect that binds
   * a country (sanctions, aid) is not the same set as one that asks a country to
   * legislate. `join_conflict` needs the wider player + NPP legislating roll;
   * `declare_war` receives the player ballot and classifies NPP members itself.
   *
   * It is also NOT the ballot. An NPP-governed member holds no vote on an entry
   * resolution — a silence under unanimity is a veto — and is still handed the
   * war the bloc voted for. Callers for other resolution types pass the ballot,
   * which for those coincides with this roll.
   */
  votingMemberIds: CountryId[] = [],
  foundingContext: Pick<OrgFoundingContext, "europeanIntegration"> = {},
  cashContext: OrganizationCashContext | null = null,
  warPlanningContext?: OrganizationWarPlanningContext
): Promise<void | boolean> {
  switch (resolution.type) {
    case "free_trade_agreement":
      return; // read by the tariff override layer; no extra state.
    case "sanctions": {
      const target = resolution.sanctionsTargetCountryId;
      const commodity = resolution.sanctionsCommodity;
      if (!target || !commodity) return;
      await applyOrganizationSanctions(db, {
        resolutionId: resolution._id,
        targetCountryId: target,
        commodity,
        members,
        createdBy: resolution.proposedByCharacterId,
        currentTurn,
        expiresTurn,
      });
      return;
    }
    case "aid_package": {
      const recipient = resolution.aidRecipientCountryId;
      const amount = resolution.aidAmount;
      if (!recipient || !amount) return;
      const paid = await payOrganizationAid(db, resolution.organizationId, recipient, amount, {
        context: cashContext,
      });
      if (paid) {
        // The political half of the bargain: a bloc that pays its clients keeps
        // them. Queued as a pull so it lands through the same cap, resistance
        // and locked gate as everything else that moves the meter.
        await queueAidAlignmentPull({
          db,
          organizationId: resolution.organizationId,
          recipient,
          amountUsd: localToUsd(
            await resolveOrgFundCurrencyCountry(db, resolution.organizationId),
            amount
          ),
          amountLocal: amount,
          turn: currentTurn,
        });
      }
      if (!paid) {
        await recordOrgHistoryEvent(
          db,
          recipient,
          currentTurn,
          `${resolution.organizationId} aid to ${countryName(recipient)} could not be disbursed — the fund was short.`,
          { organizationId: resolution.organizationId, legislationId: resolution._id.toString() }
        );
      }
      return;
    }
    case "set_dues": {
      if (resolution.duesRateAnnual !== undefined) {
        await setOrganizationDuesRate(db, resolution.organizationId, resolution.duesRateAnnual);
      }
      return;
    }
    case "declare_war": {
      const target = resolution.warDeclarationTargetCountryId;
      const warGoal = resolution.warDeclarationGoal;
      if (!target || !warGoal) return false;

      const memberIds = await getMembers(db, resolution.organizationId);
      if (memberIds.includes(target)) {
        await recordOrgHistoryEvent(
          db,
          resolution.proposingCountryId,
          currentTurn,
          `${resolution.organizationId}'s declaration lapsed because ${countryName(target)} is now a member.`,
          { organizationId: resolution.organizationId, legislationId: resolution._id.toString() }
        );
        return false;
      }

      const plan = await planOrganizationWarDeclarationFromDb({
        db,
        memberIds,
        targetCountryId: target,
        currentTurn,
        context: warPlanningContext,
      });
      if (!plan.conflictsEnabled) {
        await recordOrgHistoryEvent(
          db,
          resolution.proposingCountryId,
          currentTurn,
          `${resolution.organizationId}'s declaration lapsed because conflicts are disabled.`,
          { organizationId: resolution.organizationId, legislationId: resolution._id.toString() }
        );
        return false;
      }
      if (!plan.targetEnabled) {
        await recordOrgHistoryEvent(
          db,
          resolution.proposingCountryId,
          currentTurn,
          `${resolution.organizationId}'s declaration lapsed because ${countryName(target)} is no longer open to players.`,
          { organizationId: resolution.organizationId, legislationId: resolution._id.toString() }
        );
        return false;
      }

      await enactAutomaticOrganizationWar({
        db,
        declarers: plan.automaticNpp as CountryId[],
        defender: target,
        warGoal,
        resolutionId: resolution._id.toString(),
        currentTurn,
      });

      const playerCountries = plan.playerLegislation as CountryId[];
      const sponsorMap = await loadPolicyHeadSponsors(db, playerCountries);
      const sponsors = playerCountries.flatMap((countryId) => {
        const sponsor = sponsorMap.get(countryId);
        return sponsor
          ? [
              {
                countryId,
                characterId: sponsor._id,
                characterName: sponsor.name,
                party: sponsor.party,
                isNpp: sponsor.isNpp,
              },
            ]
          : [];
      });
      const nationalBills = await buildOrganizationWarDeclarationBills({
        db,
        preset: await loadWorldPreset(db),
        currentTurn,
        organizationId: resolution.organizationId,
        resolutionId: resolution._id.toString(),
        targetCountryId: target,
        targetCountryName: countryName(target),
        provision: {
          type: "declare_war",
          targetCountry: target,
          warGoal,
          organizationId: resolution.organizationId,
          resolutionId: resolution._id.toString(),
        },
        sponsors,
      });
      // Keep the shared phase snapshot current. Without this, two declarations
      // closing in one turn could each file a national bill before the next turn
      // reload observes the first bill's cooldown.
      for (const countryId of nationalBills.keys()) {
        warPlanningContext?.latestDeclarationTurn.set(countryId, currentTurn);
      }

      if (plan.automaticNpp.length === 0 && nationalBills.size === 0) {
        await recordOrgHistoryEvent(
          db,
          resolution.proposingCountryId,
          currentTurn,
          `${resolution.organizationId}'s declaration lapsed because no eligible member could enter the war or file a national declaration.`,
          { organizationId: resolution.organizationId, legislationId: resolution._id.toString() }
        );
        return false;
      }

      await recordOrgHistoryEvent(
        db,
        resolution.proposingCountryId,
        currentTurn,
        `${resolution.organizationId} approved war against ${countryName(target)}. ${plan.automaticNpp.length} NPP member${plan.automaticNpp.length === 1 ? "" : "s"} joined automatically and ${nationalBills.size} player legislature${nationalBills.size === 1 ? "" : "s"} opened concurrent votes.${playerCountries.length > sponsors.length ? ` ${playerCountries.length - sponsors.length} eligible member${playerCountries.length - sponsors.length === 1 ? "" : "s"} could not file a declaration because no head of government was seated.` : ""}`,
        { organizationId: resolution.organizationId, legislationId: resolution._id.toString() }
      );
      return true;
    }
    case "join_conflict": {
      const theaterId = resolution.joinConflictTheaterId;
      const side = resolution.joinConflictSide;
      if (!theaterId || !side) return;
      const warEntryOrganization = await loadOrganizationDef(
        db,
        resolution.organizationId,
        foundingContext
      );

      // A resolution sits for 24 turns; the war it was about can end inside that
      // window. Mirrors declareWar, which re-runs findWarBetween at enactment.
      const conflict = await getConflict(db, theaterId);
      // Concluded, not merely resolved: a war awaiting terms is over for every
      // purpose except the victor's choice, and admitting a new belligerent to it
      // would put a country into a fight that has already stopped.
      if (!conflict || isConflictConcluded(conflict.status)) {
        await recordOrgHistoryEvent(
          db,
          resolution.proposingCountryId,
          currentTurn,
          `${resolution.organizationId}'s entry resolution lapsed: that conflict is over.`,
          { organizationId: resolution.organizationId, legislationId: resolution._id.toString() }
        );
        return;
      }

      const entryMembers = (await getMembers(db, resolution.organizationId)).filter(
        (member): member is CountryId => member in COUNTRY_CONFIGS
      );
      const chosen = (
        side === "A" ? conflict.sideA.countries : conflict.sideB.countries
      ) as string[];
      const other = (
        side === "A" ? conflict.sideB.countries : conflict.sideA.countries
      ) as string[];
      const defendedCountry = resolution.joinConflictDefendingCountryId;
      const hosts = conflict.hostEntities ?? [conflict.hostCountry];
      if (
        defendedCountry &&
        (!chosen.includes(defendedCountry) || !hosts.includes(defendedCountry))
      ) {
        await recordOrgHistoryEvent(
          db,
          resolution.proposingCountryId,
          currentTurn,
          `${resolution.organizationId}'s defensive entry resolution lapsed: ${countryName(defendedCountry)} is no longer defending this conflict.`,
          {
            organizationId: resolution.organizationId,
            legislationId: resolution._id.toString(),
          }
        );
        return;
      }
      if (defendedCountry && !entryMembers.includes(defendedCountry)) {
        const pendingApplication = await (
          await getOrganizationProposalsCollection(db)
        ).findOne({
          organizationId: resolution.organizationId,
          proposingCountryId: defendedCountry,
          status: "pending",
        });
        if (!pendingApplication) {
          await recordOrgHistoryEvent(
            db,
            resolution.proposingCountryId,
            currentTurn,
            `${resolution.organizationId}'s defensive entry resolution lapsed: ${countryName(defendedCountry)} is no longer a member or pending applicant.`,
            {
              organizationId: resolution.organizationId,
              legislationId: resolution._id.toString(),
            }
          );
          return;
        }
      }
      const preset = await loadWorldPreset(db);

      const collectiveDefenseCandidates = entryMembers.filter(
        (countryId) =>
          !chosen.includes(countryId) &&
          !other.includes(countryId) &&
          classifyWarEntry({
            conflict,
            countryId,
            side,
            organizationId: resolution.organizationId,
            organization: warEntryOrganization ?? undefined,
            defendingCountryId: resolution.joinConflictDefendingCountryId,
          }) === "collective_defense"
      );
      const collectiveDefenseBlocks = await loadCollectiveDefenseEntryBlocks({
        db,
        conflict,
        candidates: collectiveDefenseCandidates,
        opponents: other.filter(
          (countryId): countryId is CountryId => countryId in COUNTRY_CONFIGS
        ),
        currentTurn,
      });
      for (const countryId of entryMembers) {
        if (other.includes(countryId)) {
          // A bloc resolution never switches a country's side mid-war.
          await recordOrgHistoryEvent(
            db,
            countryId,
            currentTurn,
            `${countryName(countryId)} is already fighting on the other side of ${conflict.name}.`,
            { organizationId: resolution.organizationId, legislationId: resolution._id.toString() }
          );
          continue;
        }
        if (chosen.includes(countryId)) continue;

        const stake = classifyWarEntry({
          conflict,
          countryId,
          side,
          organizationId: resolution.organizationId,
          organization: warEntryOrganization ?? undefined,
          defendingCountryId: resolution.joinConflictDefendingCountryId,
        });
        if (warEntryIsImmediate(stake)) {
          const blockedBy =
            stake === "collective_defense" ? collectiveDefenseBlocks.get(countryId) : undefined;
          if (blockedBy) {
            await recordOrgHistoryEvent(
              db,
              countryId,
              currentTurn,
              `${countryName(countryId)} could not enter ${conflict.name} under collective defence because of ${blockedBy}.`,
              {
                organizationId: resolution.organizationId,
                legislationId: resolution._id.toString(),
              }
            );
            continue;
          }
          await enactImmediateWarEntry({
            db,
            conflict,
            countryId,
            side,
            organizationId: resolution.organizationId,
            currentTurn,
            stake,
            defendingCountryId: resolution.joinConflictDefendingCountryId,
          });
          await recordOrgHistoryEvent(
            db,
            countryId,
            currentTurn,
            stake === "collective_defense"
              ? `${resolution.organizationId} collective defense invoked: entered ${conflict.name} immediately.`
              : `${countryName(countryId)} entered ${conflict.name} as a principal belligerent.`,
            { organizationId: resolution.organizationId, legislationId: resolution._id.toString() }
          );
          continue;
        }

        // Offensive coalition entry remains a national political choice, so it
        // needs a government that can actually take it. `votingMemberIds` is the
        // LEGISLATING roll here, not the ballot: an NPP-governed member holds no
        // vote on an entry resolution (silence there would veto it) and is still
        // billed for the war the bloc has now decided on. A client state with no
        // government of its own is on neither list and acquires no fictional
        // chamber.
        if (!votingMemberIds.includes(countryId)) continue;
        // A bill minted for a country no engine walks never closes — it sits at
        // active_both forever, with nothing to resolve it and nothing reporting it.
        if (!hasBillLifecycle(countryId)) {
          await recordOrgHistoryEvent(
            db,
            countryId,
            currentTurn,
            `${countryName(countryId)} could not act on ${resolution.organizationId}'s entry resolution: no legislature.`,
            { organizationId: resolution.organizationId, legislationId: resolution._id.toString() }
          );
          continue;
        }
        // The head of government sponsors it — the bill arrives at a foreign
        // power's call, so it is filed in the government's name, not a member's.
        const sponsor = await getPolicyHeadSponsor(db, countryId);
        if (!sponsor) {
          await recordOrgHistoryEvent(
            db,
            countryId,
            currentTurn,
            `${countryName(countryId)} could not act on ${resolution.organizationId}'s entry resolution: no head of government.`,
            { organizationId: resolution.organizationId, legislationId: resolution._id.toString() }
          );
          continue;
        }

        await buildJoinConflictBill({
          db,
          countryId,
          preset,
          sponsor: {
            characterId: sponsor._id,
            characterName: sponsor.name,
            party: sponsor.party,
            isNpp: sponsor.isNpp,
          },
          conflictName: conflict.name,
          organizationId: resolution.organizationId,
          provision: {
            type: "join_conflict",
            theaterId,
            side,
            organizationId: resolution.organizationId,
            resolutionId: resolution._id.toString(),
            entryStake: stake,
            politicalPressure: await assessWarEntryPoliticalPressure({
              db,
              countryId,
              organizationId: resolution.organizationId,
              organization: warEntryOrganization ?? undefined,
              stake,
              currentTurn,
            }),
          },
        });
      }
      return;
    }
    case "set_posture": {
      // The posture doc is the SSOT, read live each turn by the metric driver
      // (`loadActivePostureNudgesByCountry`); passage updates it + a history note.
      if (resolution.postureValue === undefined) return;
      await setOrganizationPosture(db, resolution.organizationId, resolution.postureValue);
      await recordOrgHistoryEvent(
        db,
        resolution.proposingCountryId,
        currentTurn,
        `${resolution.organizationId} moved to ${POSTURE_META[resolution.postureValue].label} alert posture.`,
        { organizationId: resolution.organizationId, legislationId: resolution._id.toString() }
      );
      return;
    }
    case "directive": {
      // The metric effect is read live each turn by the metric turn driver
      // (`loadActiveDirectiveNudgesByCountry`) for as long as the directive is
      // active, so passage needs no metric write — just a history note.
      const def = getDirectiveDef(resolution.directiveKey);
      if (!def) return;
      await recordOrgHistoryEvent(
        db,
        resolution.proposingCountryId,
        currentTurn,
        `${resolution.organizationId} adopted the ${def.label} directive across ${members.length} member${members.length === 1 ? "" : "s"}.`,
        { organizationId: resolution.organizationId, legislationId: resolution._id.toString() }
      );
      return;
    }
    case "fund_agency": {
      // Draw the programme's cost from the pooled fund. Funded → the member-wide
      // metric effect is read live each turn (`loadActiveAgencyNudgesByCountry`)
      // until expiry. Underfunded → terminate now so the effect is never read.
      const def = getAgencyDef(resolution.agencyKey);
      if (!def) return;
      // Catalog costs are in USD; convert to the fund's (founding) currency to draw.
      const fundCountry = await resolveOrgFundCurrencyCountry(db, resolution.organizationId);
      const fundRate = getGdpAnchorRate(fundCountry, await loadWorldPreset(db));
      const costFund = Math.round(def.costUsd / fundRate);
      const funded = await disburseFromOrganizationFund(db, resolution.organizationId, costFund, {
        context: cashContext,
      });
      if (!funded) {
        const col = await getOrganizationLegislationCollection(db);
        await col.updateOne(
          { _id: resolution._id },
          { $set: { status: "terminated", terminatedAt: new Date() } }
        );
        await recordOrgHistoryEvent(
          db,
          resolution.proposingCountryId,
          currentTurn,
          `${resolution.organizationId} could not fund the ${def.label} — the pooled fund was short.`,
          { organizationId: resolution.organizationId, legislationId: resolution._id.toString() }
        );
        return;
      }
      await recordOrgHistoryEvent(
        db,
        resolution.proposingCountryId,
        currentTurn,
        `${resolution.organizationId} funded the ${def.label} across ${members.length} member${members.length === 1 ? "" : "s"}.`,
        { organizationId: resolution.organizationId, legislationId: resolution._id.toString() }
      );
      return;
    }
    case "joint_statement": {
      // The bounded approval effect is read live each turn by the government-
      // approval snapshot (`getActiveOrgStatementModifiersByCountry`) while the
      // statement is active, so passage only needs a history note.
      const subject = resolution.jointStatementSubjectCountryId;
      if (!subject) return;
      const verb = resolution.jointStatementStance === "condemn" ? "condemned" : "endorsed";
      await recordOrgHistoryEvent(
        db,
        subject,
        currentTurn,
        `${resolution.organizationId} ${verb} ${countryName(subject)}.`,
        { organizationId: resolution.organizationId, legislationId: resolution._id.toString() }
      );
      return;
    }
  }
}

export async function captureDiplomaticExpiry(
  db: Db,
  turn: number,
  item: OrganizationLegislation
): Promise<void> {
  await captureServerGameEvent({
    db,
    turn,
    event: "diplomacy_status_changed",
    distinctId: "system:turn-processor",
    insertId: `diplomacy-expired:${item._id}`,
    nationId: item.proposingCountryId,
    properties: {
      proposal_id: item._id.toString(),
      organization_id: item.organizationId,
      action_type: item.type,
      from_status: "active",
      to_status: "terminated",
      transition_type: "expiry",
    },
  });
}

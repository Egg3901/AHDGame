import { type AlignmentPoleId } from "@/lib/constants/alignmentEras";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { canTableResolutionType } from "@/lib/constants/orgCategory";
import {
  ballotIsPlayerOnly,
  type OrgBallotKind,
} from "@/lib/internationalOrganizations/resolutionRules";
import { hostSideOf } from "@/lib/military/warEntryPolicy";
import {
  BELLIGERENT_WAR_ACTION_BASE,
  clamp,
  round,
  alreadyVoted,
  memberOrganizations,
  activeEmbargo,
  opinionReasons,
  type ForeignPolicyActionType,
  type ForeignPolicyChoice,
  type CountryOpinion,
  type ForeignPolicyContext,
} from "./foreignPolicyShared";

export function candidate(
  type: ForeignPolicyActionType,
  score: number,
  reasons: string[],
  detail?: Pick<
    ForeignPolicyChoice,
    | "targetCountryId"
    | "organizationId"
    | "conflictId"
    | "conflictSide"
    | "pendingItemId"
    | "pendingKind"
  >
): ForeignPolicyChoice {
  return { type, score: round(score), reasons, ...detail };
}

function organizationThatCanTable(
  context: ForeignPolicyContext,
  organizationIds: string[],
  type: Parameters<typeof canTableResolutionType>[1]
): string | undefined {
  return organizationIds.find((organizationId) => {
    const category = context.organizationCategories.get(organizationId);
    return category ? canTableResolutionType(category, type) : false;
  });
}

/**
 * Ballots this planner must not cast, because the country can never be on their
 * roll.
 *
 * An admission and a bloc war entry are decided by the player-enabled members
 * alone (`ballotIsPlayerOnly`), and the planner only ever runs for a country
 * that is NOT player-enabled — `isNppAutonomyActive` requires exactly that. So
 * every such ballot it cast was guaranteed to be ignored by the resolver.
 *
 * Writing them was never free. The row still lands on the proposal, where it is
 * read back by anything listing who has voted, so a bloc showed "yes" rows from
 * members whose consent the tally beside them did not count (ticket #1257). And
 * now that ballots no longer compete for the country's one strategic action,
 * these would be cast reliably every cycle rather than occasionally.
 */
function planningCountryHoldsNoBallot(kind: OrgBallotKind): boolean {
  return ballotIsPlayerOnly(kind);
}

export function voteCandidates(
  context: ForeignPolicyContext,
  opinions: Map<CountryId, CountryOpinion>
): ForeignPolicyChoice[] {
  const choices: ForeignPolicyChoice[] = [];
  const sourceOrganizations = memberOrganizations(context.memberships, context.countryId);

  for (const proposal of context.pendingMemberships) {
    if (planningCountryHoldsNoBallot("membership_proposal")) continue;
    if (!sourceOrganizations.has(proposal.organizationId)) continue;
    if (proposal.proposingCountryId === context.countryId) continue;
    if (alreadyVoted(proposal.votes, context.countryId)) continue;
    const opinion = opinions.get(proposal.proposingCountryId);
    if (!opinion) continue;
    const yes = opinion.score >= 0;
    choices.push(
      candidate(
        yes ? "vote_org_yes" : "vote_org_no",
        48 + Math.abs(opinion.score) * 0.35,
        [
          `${proposal.organizationId} membership for ${COUNTRY_CONFIGS[proposal.proposingCountryId].name} is pending.`,
          ...opinionReasons(opinion),
        ],
        {
          targetCountryId: proposal.proposingCountryId,
          organizationId: proposal.organizationId,
          pendingItemId: proposal._id.toString(),
          pendingKind: "membership",
        }
      )
    );
  }

  for (const item of context.pendingLegislation) {
    if (planningCountryHoldsNoBallot(item.type)) continue;
    if (!sourceOrganizations.has(item.organizationId)) continue;
    if (alreadyVoted(item.votes, context.countryId)) continue;
    if (item.type === "free_trade_agreement" && !item.parties.includes(context.countryId)) {
      continue;
    }
    let subject: CountryId | undefined;
    let support = 0;
    if (item.type === "free_trade_agreement") {
      const parties = item.parties.filter((party) => party !== context.countryId);
      if (parties.length > 0) {
        support =
          parties.reduce((sum, party) => sum + (opinions.get(party)?.score ?? 0), 0) /
          parties.length;
        subject = parties[0];
      }
    } else if (item.type === "sanctions") {
      subject = item.sanctionsTargetCountryId;
      support = -(subject ? (opinions.get(subject)?.score ?? 0) : 0);
    } else if (item.type === "aid_package") {
      subject = item.aidRecipientCountryId;
      support = subject ? (opinions.get(subject)?.score ?? 0) : 0;
    } else if (item.type === "joint_statement") {
      subject = item.jointStatementSubjectCountryId;
      const base = subject ? (opinions.get(subject)?.score ?? 0) : 0;
      support = item.jointStatementStance === "condemn" ? -base : base;
    } else if (item.type === "join_conflict") {
      const conflict = context.conflicts.find(
        (candidate) => candidate._id === item.joinConflictTheaterId
      );
      const side = item.joinConflictSide;
      if (conflict && side) {
        const allies = side === "A" ? conflict.sideA.countries : conflict.sideB.countries;
        const enemies = side === "A" ? conflict.sideB.countries : conflict.sideA.countries;
        const averageOpinion = (countries: CountryId[]) => {
          const scores = countries
            .filter((countryId) => countryId !== context.countryId)
            .map((countryId) => opinions.get(countryId)?.score)
            .filter((score): score is number => score !== undefined);
          return scores.length > 0
            ? scores.reduce((sum, score) => sum + score, 0) / scores.length
            : 0;
        };
        const collectiveDefense = hostSideOf(conflict) === side;
        support = collectiveDefense
          ? 100
          : -15 +
            averageOpinion(allies) * 0.4 -
            averageOpinion(enemies) * 0.25 +
            context.head.personality.ambition * 0.15 -
            context.head.personality.stubbornness * 0.1;
      } else {
        support = context.head.personality.ambition - context.head.personality.stubbornness * 0.25;
      }
    } else {
      support = context.head.personality.loyalty - 35;
    }
    const yes = support >= 0;
    choices.push(
      candidate(
        yes ? "vote_org_yes" : "vote_org_no",
        46 + Math.min(35, Math.abs(support) * 0.4),
        [
          `${item.organizationId} has a pending ${item.type.replace(/_/g, " ")} resolution.`,
          ...(subject && opinions.has(subject) ? opinionReasons(opinions.get(subject)!) : []),
        ],
        {
          ...(subject ? { targetCountryId: subject } : {}),
          organizationId: item.organizationId,
          pendingItemId: item._id.toString(),
          pendingKind: "legislation",
        }
      )
    );
  }

  for (const election of context.pendingLeadership) {
    if (!sourceOrganizations.has(election.organizationId)) continue;
    if (alreadyVoted(election.votes, context.countryId)) continue;
    const opinion = opinions.get(election.candidateCountryId);
    if (!opinion) continue;
    const yes = opinion.score >= -10;
    choices.push(
      candidate(
        yes ? "vote_org_yes" : "vote_org_no",
        42 + Math.abs(opinion.score) * 0.25,
        [
          `${election.candidateCharacterName} of ${COUNTRY_CONFIGS[election.candidateCountryId].name} seeks ${election.organizationId} leadership.`,
          ...opinionReasons(opinion),
        ],
        {
          targetCountryId: election.candidateCountryId,
          organizationId: election.organizationId,
          pendingItemId: election._id.toString(),
          pendingKind: "leadership",
        }
      )
    );
  }

  return choices;
}

export function bilateralCandidates(
  context: ForeignPolicyContext,
  opinions: CountryOpinion[]
): ForeignPolicyChoice[] {
  const choices: ForeignPolicyChoice[] = [];
  const sourceOrganizations = memberOrganizations(context.memberships, context.countryId);
  const debtBrake = clamp(context.debtToGdpRatio / 150, 0, 1);
  const ambition = clamp(context.head.personality.ambition / 100, 0, 1);
  const stubbornness = clamp(context.head.personality.stubbornness / 100, 0, 1);
  const tradeLean = clamp(
    ((context.head.policies.domainPositions?.trade ?? context.head.policies.economic) + 100) / 200,
    0,
    1
  );

  for (const opinion of opinions) {
    const target = opinion.targetCountryId;
    const targetOrganizations = memberOrganizations(context.memberships, target);
    const sharedOrganizations = Array.from(sourceOrganizations).filter((orgId) =>
      targetOrganizations.has(orgId)
    );
    const ftaOrganization = organizationThatCanTable(
      context,
      sharedOrganizations,
      "free_trade_agreement"
    );
    const aidOrganization = organizationThatCanTable(context, sharedOrganizations, "aid_package");
    // NOT `sharedOrganizations`. An organisation sanctions an OUTSIDER, so the
    // one instrument here whose venue must EXCLUDE the target is this one —
    // sharing the roll is what makes an FTA, aid or an endorsement possible, and
    // it is exactly what makes sanctions incoherent. Drawn from the shared list
    // the target was a fellow member by construction, and Greece spent two turns
    // tabling Warsaw Pact sanctions against its own allies (ticket #1285).
    // `proposeLegislation` refuses these outright, so a planner still choosing
    // them would burn the country's one strategic action on a certain refusal.
    const organizationsWithoutTarget = Array.from(sourceOrganizations).filter(
      (orgId) => !targetOrganizations.has(orgId)
    );
    const sanctionsOrganization = organizationThatCanTable(
      context,
      organizationsWithoutTarget,
      "sanctions"
    );
    const statementOrganization = organizationThatCanTable(
      context,
      sharedOrganizations,
      "joint_statement"
    );
    const pendingTargetedTariff = context.pendingTariffTargets.has(target);
    const reasons = opinionReasons(opinion);
    const resolutions = [...context.activeResolutions, ...context.pendingLegislation];
    const hasFta = resolutions.some(
      (item) =>
        item.type === "free_trade_agreement" &&
        item.parties.includes(context.countryId) &&
        item.parties.includes(target)
    );
    const hasAid = resolutions.some(
      (item) => item.type === "aid_package" && item.aidRecipientCountryId === target
    );
    const hasSanctions = resolutions.some(
      (item) => item.type === "sanctions" && item.sanctionsTargetCountryId === target
    );
    const hasEndorsement = resolutions.some(
      (item) =>
        item.type === "joint_statement" &&
        item.jointStatementSubjectCountryId === target &&
        item.jointStatementStance === "endorse"
    );
    const hasCondemnation = resolutions.some(
      (item) =>
        item.type === "joint_statement" &&
        item.jointStatementSubjectCountryId === target &&
        item.jointStatementStance === "condemn"
    );
    const outgoingEmbargo = context.embargoes.find(
      (embargo) =>
        embargo.sourceCountry === context.countryId &&
        embargo.targetCountry === target &&
        activeEmbargo(embargo, context.currentTurn)
    );
    const targetedTariff = context.tariffs.find(
      (tariff) =>
        tariff.countryId === context.countryId &&
        tariff.scopeType === "origin_country" &&
        tariff.targetOriginCountryId === target &&
        tariff.rate > 0
    );

    if (opinion.score >= 20 && sharedOrganizations.length > 0) {
      if (!hasFta && ftaOrganization) {
        choices.push(
          candidate(
            "propose_fta",
            15 + opinion.score * 0.45 + tradeLean * 14 + opinion.tradeDependence * 12,
            [`A shared organization can host a free trade agreement.`, ...reasons],
            { targetCountryId: target, organizationId: ftaOrganization }
          )
        );
      }
      if (!hasEndorsement && statementOrganization) {
        choices.push(
          candidate(
            "endorse_country",
            12 + opinion.score * 0.4 + ambition * 8,
            [`Relations are favorable enough for public support.`, ...reasons],
            { targetCountryId: target, organizationId: statementOrganization }
          )
        );
      }
      if (!hasAid && aidOrganization) {
        choices.push(
          candidate(
            "propose_aid",
            8 + opinion.score * 0.4 + ambition * 10 - debtBrake * 22,
            [
              `Friendly relations support aid, while debt applies a ${round(debtBrake * 22)} point brake.`,
              ...reasons,
            ],
            { targetCountryId: target, organizationId: aidOrganization }
          )
        );
      }
    }

    const hostile = Math.max(0, -opinion.score);
    if (hostile > 0) {
      if (!targetedTariff && !pendingTargetedTariff) {
        choices.push(
          candidate(
            "raise_tariff",
            10 + hostile * 0.48 + stubbornness * 10 - opinion.tradeDependence * 22,
            [
              `Hostility supports a targeted tariff, but trade dependence applies a ${round(opinion.tradeDependence * 22)} point brake.`,
              ...reasons,
            ],
            { targetCountryId: target }
          )
        );
      }
      if (!outgoingEmbargo) {
        choices.push(
          candidate(
            "impose_embargo",
            5 + hostile * 0.55 + stubbornness * 12 - opinion.tradeDependence * 30,
            [
              `Hostility supports an embargo, but trade dependence applies a ${round(opinion.tradeDependence * 30)} point brake.`,
              ...reasons,
            ],
            { targetCountryId: target }
          )
        );
      }
      if (!hasSanctions && sanctionsOrganization) {
        choices.push(
          candidate(
            "propose_sanctions",
            8 + hostile * 0.55 + ambition * 8,
            [`An organization the target does not sit in can coordinate sanctions.`, ...reasons],
            { targetCountryId: target, organizationId: sanctionsOrganization }
          )
        );
      }
      if (!hasCondemnation && statementOrganization) {
        choices.push(
          candidate(
            "condemn_country",
            12 + hostile * 0.45 + ambition * 10,
            [`Relations are hostile enough for a condemnation.`, ...reasons],
            { targetCountryId: target, organizationId: statementOrganization }
          )
        );
      }
    }

    if (outgoingEmbargo && opinion.score > -15) {
      choices.push(
        candidate(
          "lift_embargo",
          28 + opinion.score * 0.35 + tradeLean * 8,
          [`Relations no longer justify the active embargo.`, ...reasons],
          { targetCountryId: target }
        )
      );
    }

    if (targetedTariff && !pendingTargetedTariff && opinion.score > 10) {
      choices.push(
        candidate(
          "lower_tariff",
          24 + opinion.score * 0.35 + tradeLean * 10,
          [`Friendly relations no longer justify the targeted tariff.`, ...reasons],
          { targetCountryId: target }
        )
      );
    }
  }

  return choices;
}

export function warCandidates(
  context: ForeignPolicyContext,
  opinions: Map<CountryId, CountryOpinion>
): ForeignPolicyChoice[] {
  const choices: ForeignPolicyChoice[] = [];
  const sourceOrganizations = memberOrganizations(context.memberships, context.countryId);
  const sourceAlignment = context.alignments.find(
    (alignment) => alignment.entityId === context.countryId
  );
  const ambition = clamp(context.head.personality.ambition / 100, 0, 1);
  const debtBrake = clamp(context.debtToGdpRatio / 150, 0, 1);
  const defenseLean = clamp(
    ((context.head.policies.domainPositions?.defense ?? 0) + 100) / 200,
    0,
    1
  );

  for (const conflict of context.conflicts) {
    const ownSide = conflict.sideA.countries.includes(context.countryId)
      ? conflict.sideA
      : conflict.sideB.countries.includes(context.countryId)
        ? conflict.sideB
        : null;
    if (ownSide) {
      const enemySide = ownSide === conflict.sideA ? conflict.sideB : conflict.sideA;
      const enemyCountry = enemySide.countries.find((countryId) => COUNTRY_CONFIGS[countryId]);
      const deployed = context.militaryUnits.filter(
        (unit) => unit.theaterId === conflict._id && unit.personnel > 0
      );
      const deployedReadiness =
        deployed.length > 0
          ? deployed.reduce((sum, unit) => sum + unit.readiness, 0) / deployed.length
          : 0;
      const pendingOffensive = context.pendingBattleDeclarations.some(
        (declaration) => declaration.theaterId === conflict._id
      );
      const pendingPeace = context.pendingPeaceOffers.some(
        (offer) =>
          offer.conflictId === conflict._id &&
          offer.fromCountry === context.countryId &&
          offer.toCountry === enemyCountry &&
          offer.expiresTurn > context.currentTurn
      );
      if (
        context.offensiveInitiationEnabled &&
        deployed.length > 0 &&
        deployedReadiness >= 40 &&
        context.approvalRating >= 40 &&
        !pendingOffensive
      ) {
        choices.push(
          candidate(
            "conduct_war",
            BELLIGERENT_WAR_ACTION_BASE +
              ambition * 8 +
              defenseLean * 10 +
              (deployedReadiness - 40) * 0.2,
            [
              `${deployed.length} deployed units average ${round(deployedReadiness)} readiness in ${conflict.name}.`,
              `Government approval is ${round(context.approvalRating)}.`,
            ],
            { conflictId: conflict._id }
          )
        );
      }
      if (
        enemyCountry &&
        !pendingPeace &&
        (context.approvalRating < 35 || deployedReadiness < 35 || context.debtToGdpRatio > 140)
      ) {
        choices.push(
          candidate(
            "seek_peace",
            BELLIGERENT_WAR_ACTION_BASE +
              Math.max(0, 35 - context.approvalRating) * 0.4 +
              Math.max(0, 35 - deployedReadiness) * 0.3 +
              Math.max(0, context.debtToGdpRatio - 140) * 0.1,
            [
              `War pressure in ${conflict.name} exceeds the government's tolerance.`,
              `Approval ${round(context.approvalRating)}, deployed readiness ${round(deployedReadiness)}, debt ${round(context.debtToGdpRatio)}% of GDP.`,
            ],
            { targetCountryId: enemyCountry, conflictId: conflict._id }
          )
        );
      }
      continue;
    }
    const sideScore = (countries: CountryId[]): number =>
      countries.reduce((sum, countryId) => sum + (opinions.get(countryId)?.score ?? 0), 0) /
      Math.max(1, countries.length);
    const a = sideScore(conflict.sideA.countries);
    const b = sideScore(conflict.sideB.countries);
    const preferredSide = a >= b ? "A" : "B";
    const preferred = preferredSide === "A" ? conflict.sideA : conflict.sideB;
    const preferredScore = Math.max(a, b);
    const representative = preferred.countries.find((countryId) => COUNTRY_CONFIGS[countryId]);
    if (!representative) continue;
    const representativeOrganizations = memberOrganizations(context.memberships, representative);
    const sharedOrganizations = Array.from(sourceOrganizations).filter((orgId) =>
      representativeOrganizations.has(orgId)
    );
    const materialSupportOrganization =
      sharedOrganizations.find(
        (orgId) => context.organizationCategories.get(orgId) === "economic"
      ) ?? sharedOrganizations[0];
    const securityOrganization = sharedOrganizations.find(
      (orgId) => orgId === "NATO" || orgId === "WARSAW_PACT"
    );
    const poleSupport = sourceAlignment
      ? Object.entries(sourceAlignment.shares).reduce((best, [pole, share]) => {
          const leader = context.poleLeaders.get(pole as AlignmentPoleId);
          return preferred.countries.includes(leader as CountryId)
            ? Math.max(best, share ?? 0)
            : best;
        }, 0)
      : 0;
    const base = preferredScore * 0.35 + poleSupport * 0.25 + ambition * 10 + defenseLean * 12;
    const hasSupportPackage = [...context.activeResolutions, ...context.pendingLegislation].some(
      (item) => item.type === "aid_package" && item.aidRecipientCountryId === representative
    );
    if (materialSupportOrganization && !hasSupportPackage) {
      choices.push(
        candidate(
          "support_war",
          12 + base - debtBrake * 15,
          [
            `${preferred.label} is the more compatible side in ${conflict.name}.`,
            `Superpower influence contributes ${round(poleSupport * 0.25)}.`,
            `Debt applies a ${round(debtBrake * 15)} point support brake.`,
          ],
          {
            targetCountryId: representative,
            organizationId: materialSupportOrganization,
            conflictId: conflict._id,
          }
        )
      );
    }
    const hasJoinProposal = context.pendingLegislation.some(
      (item) =>
        item.type === "join_conflict" &&
        item.joinConflictTheaterId === conflict._id &&
        item.joinConflictSide === preferredSide
    );
    const warEntryReady =
      context.availableMilitaryUnits > 0 &&
      context.averageMilitaryReadiness >= 55 &&
      context.approvalRating >= 45 &&
      context.debtToGdpRatio <= 120;
    if (securityOrganization && !hasJoinProposal && warEntryReady) {
      choices.push(
        candidate(
          "join_war",
          -8 +
            base +
            (context.averageMilitaryReadiness - 55) * 0.25 +
            (context.approvalRating - 45) * 0.2,
          [
            `${preferred.label} is the more compatible side in ${conflict.name}.`,
            "War entry remains guarded by an alliance vote and domestic ratification.",
            `${context.availableMilitaryUnits} ready reserve units average ${round(context.averageMilitaryReadiness)} readiness with ${round(context.approvalRating)} government approval.`,
          ],
          {
            targetCountryId: representative,
            organizationId: securityOrganization,
            conflictId: conflict._id,
            conflictSide: preferredSide,
          }
        )
      );
    }
  }
  return choices;
}

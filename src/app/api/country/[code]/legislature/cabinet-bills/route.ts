// GET/POST /api/country/[code]/legislature/cabinet-bills — list or propose cabinet bills
// Auth: GET public, POST requireAuthWithCharacter (PM or cabinet member)
// Error codes: 400, 401, 403, 409
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { getAuthUser } from "@/lib/auth";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError, badRequest, forbidden, errorResponse } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { COUNTRY_CONFIGS, getCountryConfig, type CountryId } from "@/lib/constants/countries";
import { getGovernmentFormationsCollection } from "@/lib/db/collections/governmentFormation";
import { getCharacterByUserId } from "@/lib/db/characterLookup";
import { checkLegislationFreeze } from "@/lib/api/parliamentaryFreeze";
import { getCabinetMechanics } from "@/lib/constants/cabinetMechanics";
import { unionLegislativeDomains } from "@/lib/uk/dualMinistry/rules";
import type { BillDisplay } from "@/lib/legislature/dto/billDisplay";
import { getPartyHex, formatBillPositionLabel } from "@/lib/utils/politics";
import {
  directionLabel,
  effectTargetLabelFromMetricId,
  axisRelevant,
} from "@/lib/congress/billEnrichment";
import {
  checkDuplicateProvisions,
  checkDuplicateResetLawFamilies,
  checkCurrentPolicyLevel,
  NATIONAL_TERMINAL_STATUSES,
} from "@/lib/congress/billProposalLimits";
import {
  canonicalizeLegislationTypeId,
  getLegislationTypeById,
  humanizeLegislationTypeId,
} from "@/lib/legislationTypeAliases";
import { billRequiresExecutiveAction } from "@/lib/internationalOrganizations/withdrawalBills";
import type { Bill, BillStatus, LegislationType, Character } from "@/lib/db/types";
import { isPolicyProvision } from "@/lib/db/types/legislation";
import {
  BILL_PROPOSE_ACTION_COST,
  getProvisionCostTotal,
  MAX_PROVISIONS,
  NATIONALIZATION_BILL_CATEGORIES,
} from "@shared/constants/legislation";
import { validateNationalizationProvisions } from "@/lib/nationalization/billProvisionValidation";
import {
  getBillProposalAutoFailWarning,
  getBillProposalAutoFailWarningError,
} from "@/lib/legislature/billAutoFailWarning";
import { z } from "zod";
import { moderatedBillTitle, moderatedBillText } from "@/lib/api/schemas/congress";
import { validateBillAdministration } from "@/lib/legislature/jurisdiction";
import { findAdministrationConflict } from "@/lib/legislature/administrationConflictCheck";
import { getGameState } from "@/lib/gameState";
import { snapshotBillPolicyProvisions, validateBillProvisions } from "@/lib/congress/billProposal";
import { RESET_V2_READY } from "@/lib/resetVersions/availability";
import { isResetV2Country, resetSystemVersionsForCountry } from "@/lib/resetVersions/rules";
import { loadBillLegislationTypes } from "@/lib/legislature/queries/loadBillLegislationTypes";
import { resetTaxesFor } from "@/lib/resetLegislation/taxCatalog";
import type { ResetCountry } from "@/lib/resetLegislation/fundingOwner";
import { getNationalDocId } from "@/lib/constants/nationalScope";

const CABINET_VOTE_DURATION_MS = 24 * 3_600_000; // 24 hours
type BillListProvisionDisplay = NonNullable<BillDisplay["provisions"]>[number];

const proposeCabinetBillSchema = z.object({
  title: moderatedBillTitle(z.string().min(1).max(200)),
  summary: moderatedBillText(z.string().min(1).max(2000)),
  fullText: moderatedBillText(z.string().max(10000)).optional().default(""),
  legislationTypeId: z.string().optional(),
  policyOptionId: z.string().optional(),
  category: z.string().optional().default("general"),
  stateId: z.string().optional(),
  effectDirection: z.number().optional().default(0),
  provisions: z.array(z.unknown()).max(MAX_PROVISIONS).optional(),
  confirmElectionRisk: z.boolean().optional(),
});

/**
 * GET — fetch current/recent cabinet bills for the Cabinet tab.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return errorResponse(400, "Invalid country code");
    }

    const config = getCountryConfig(countryId);
    if (!config.cabinetBillsEnabled) {
      return NextResponse.json({ bills: [] });
    }

    const db = await getDb();
    const [proposalWarning, authUser, gov, bills, activeBillsForProvisions, parties] =
      await Promise.all([
        getBillProposalAutoFailWarning(db, countryId, "cabinet"),
        getAuthUser().catch(() => null),
        getGovernmentFormationsCollection(db).findOne({ _id: countryId }),
        db
          .collection<Bill>("bills")
          .find({ countryId, originChamber: "cabinet" })
          .sort({ createdAt: -1 })
          .limit(20)
          .toArray(),
        db
          .collection<Bill>("bills")
          .find(
            { countryId, status: { $nin: NATIONAL_TERMINAL_STATUSES as BillStatus[] } },
            { projection: { provisions: 1 } }
          )
          .toArray(),
        db
          .collection<{ sequentialId: number; name?: string; color?: string }>("politicalParties")
          .find({ countryId })
          .toArray(),
      ]);

    const partyMap = new Map(parties.map((party) => [String(party.sequentialId), party]));
    const legislationTypeMap = await loadBillLegislationTypes(db, bills);

    let myCharacterId: string | null = null;
    let canVoteCabinetReview = false;
    let canPropose = false;
    let allowedPolicyDomains: string[] | null = [];
    if (authUser) {
      if (authUser.isAdmin) {
        canPropose = true;
        allowedPolicyDomains = null;
      } else {
        const character = await getCharacterByUserId(db, authUser.userId);
        if (character) {
          myCharacterId = character._id.toString();
          const existingActiveBill = await db.collection<Bill>("bills").findOne({
            sponsorId: character._id,
            countryId,
            status: { $nin: NATIONAL_TERMINAL_STATUSES as BillStatus[] },
          });
          const isPM = gov?.pmCharacterId?.toString() === character._id.toString();
          canVoteCabinetReview = isPM;
          if (isPM) {
            canPropose = !existingActiveBill;
            allowedPolicyDomains = null;
          } else {
            // A dual-office holder proposes from the union of both portfolios
            // (issue #2049): every row they hold contributes its domains, so the
            // second title widens what they may propose but never votes twice.
            const cabinetRows = await db
              .collection("cabinetMembers")
              .find({ characterId: character._id, countryId })
              .project({ positionId: 1 })
              .toArray();
            if (cabinetRows.length > 0 && !existingActiveBill) {
              canPropose = true;
              allowedPolicyDomains = unionLegislativeDomains(
                cabinetRows.map((row) => {
                  const positionId = (row as { positionId?: string }).positionId;
                  const mechanics = positionId
                    ? getCabinetMechanics(countryId, positionId)
                    : undefined;
                  return mechanics
                    ? (mechanics.legislativeDomains ??
                        mechanics.nationalMetrics.map((metric) => metric.category))
                    : [];
                })
              );
            }
            canVoteCabinetReview = cabinetRows.length > 0;
          }
        }
      }
    }

    const myVoteMap = new Map<string, "for" | "against" | "abstain" | null>();
    if (myCharacterId && bills.length > 0) {
      const billIds = bills.map((bill) => bill._id);
      const voteRows = await db
        .collection("bills")
        .find(
          { _id: { $in: billIds } },
          {
            projection: {
              [`votes.${myCharacterId}`]: 1,
            },
          }
        )
        .toArray();
      for (const row of voteRows) {
        const votes = (row as Record<string, unknown>).votes as Record<string, string> | undefined;
        myVoteMap.set(
          row._id.toString(),
          (votes?.[myCharacterId] ?? null) as "for" | "against" | "abstain" | null
        );
      }
    }

    const blockedProvisions: { legislationTypeId: string; policyOptionId: string }[] = [];
    for (const bill of activeBillsForProvisions) {
      if (!bill.provisions) continue;
      for (const provision of bill.provisions) {
        if ("type" in provision) continue;
        const policyProvision = provision as {
          legislationTypeId?: string;
          policyOptionId?: string;
        };
        if (policyProvision.legislationTypeId && policyProvision.policyOptionId) {
          blockedProvisions.push({
            legislationTypeId:
              canonicalizeLegislationTypeId(policyProvision.legislationTypeId) ??
              policyProvision.legislationTypeId,
            policyOptionId: policyProvision.policyOptionId,
          });
        }
      }
    }

    const billDisplays: BillDisplay[] = bills.map((bill) => {
      const partySlug = bill.sponsorParty ?? "";
      const party = partyMap.get(partySlug);
      const firstPolicy = bill.provisions?.find(isPolicyProvision);
      const displayProvisions: BillListProvisionDisplay[] | undefined = bill.provisions
        ?.filter(isPolicyProvision)
        .map((provision) => {
          const legislationType = getLegislationTypeById(
            legislationTypeMap,
            provision.legislationTypeId
          );
          const positionLabel =
            provision.economic != null || provision.social != null
              ? formatBillPositionLabel(provision.economic, provision.social)
              : undefined;
          const policyOption =
            provision.policyOptionId && legislationType?.policyOptions
              ? legislationType.policyOptions.find(
                  (option) => option.id === provision.policyOptionId
                )
              : undefined;
          const optionLabel = policyOption?.explanation ?? policyOption?.name;
          return {
            legislationTypeId:
              canonicalizeLegislationTypeId(provision.legislationTypeId) ??
              provision.legislationTypeId,
            legislationTypeName:
              legislationType?.name ??
              humanizeLegislationTypeId(provision.legislationTypeId) ??
              provision.legislationTypeId,
            effectDirection: provision.effectDirection,
            directionLabel: directionLabel(provision.effectDirection),
            ...(positionLabel && { positionLabel }),
            effectTargetLabel:
              optionLabel ??
              (legislationType?.effectTarget?.metricId
                ? effectTargetLabelFromMetricId(legislationType.effectTarget.metricId)
                : undefined),
            ...(provision.economic != null &&
              axisRelevant(legislationType, "economic") && { economic: provision.economic }),
            ...(provision.social != null &&
              axisRelevant(legislationType, "social") && { social: provision.social }),
          };
        });

      const firstDisplayProvision = displayProvisions?.[0];
      const headlineLegislationType = getLegislationTypeById(
        legislationTypeMap,
        bill.legislationTypeId ?? firstPolicy?.legislationTypeId
      );
      const headlineDirection = bill.effectDirection ?? firstPolicy?.effectDirection ?? null;
      const headlinePositionLabel =
        firstPolicy && (firstPolicy.economic != null || firstPolicy.social != null)
          ? formatBillPositionLabel(firstPolicy.economic, firstPolicy.social)
          : null;
      const headlineEffectTargetLabel = (() => {
        if (firstPolicy?.policyOptionId && headlineLegislationType?.policyOptions) {
          const option = headlineLegislationType.policyOptions.find(
            (candidate) => candidate.id === firstPolicy.policyOptionId
          );
          if (option) return option.explanation ?? option.name;
        }
        return headlineLegislationType?.effectTarget?.metricId
          ? effectTargetLabelFromMetricId(headlineLegislationType.effectTarget.metricId)
          : null;
      })();
      const myVote = myVoteMap.get(bill._id.toString()) ?? null;

      return {
        id: bill._id.toString(),
        title: bill.title,
        summary: bill.summary,
        ...(bill.adminProposed ? { adminProposed: true } : {}),
        originChamber: bill.originChamber,
        currentChamber: bill.currentChamber,
        sponsorId: bill.sponsorId?.toString() ?? null,
        sponsorName: bill.sponsorName,
        sponsorParty: partySlug,
        sponsorPartyName: party?.name ?? (partySlug || "Independent"),
        sponsorPartyColor: getPartyHex(partySlug, party?.color),
        status: bill.status,
        votesFor: bill.votesFor,
        votesAgainst: bill.votesAgainst,
        votesAbstain: bill.votesAbstain,
        totalVotes: bill.votesFor + bill.votesAgainst + bill.votesAbstain,
        otherChamberVotesFor: bill.otherChamberVotesFor ?? 0,
        otherChamberVotesAgainst: bill.otherChamberVotesAgainst ?? 0,
        otherChamberVotesAbstain: bill.otherChamberVotesAbstain ?? 0,
        category: bill.category ?? "general",
        legislationTypeId:
          canonicalizeLegislationTypeId(bill.legislationTypeId ?? firstPolicy?.legislationTypeId) ??
          firstDisplayProvision?.legislationTypeId ??
          null,
        legislationTypeName:
          headlineLegislationType?.name ??
          firstDisplayProvision?.legislationTypeName ??
          humanizeLegislationTypeId(bill.legislationTypeId ?? firstPolicy?.legislationTypeId) ??
          null,
        effectDirection: headlineDirection,
        directionLabel: headlineDirection != null ? directionLabel(headlineDirection) : null,
        positionLabel: headlinePositionLabel,
        effectTargetLabel:
          headlineEffectTargetLabel ?? firstDisplayProvision?.effectTargetLabel ?? null,
        provisions: displayProvisions,
        proposedAt: bill.proposedAt.toISOString(),
        votingStartedAt: bill.votingStartedAt?.toISOString() ?? null,
        votingEndsAt: bill.votingEndsAt?.toISOString() ?? null,
        votingEndsOnTurn: bill.votingEndsOnTurn ?? null,
        otherChamberVotingEndsAt: bill.otherChamberVotingEndsAt?.toISOString() ?? null,
        otherChamberVotingEndsOnTurn: bill.otherChamberVotingEndsOnTurn ?? null,
        passedAt: bill.passedOriginAt?.toISOString() ?? null,
        enactedAt: bill.enactedAt?.toISOString() ?? null,
        myVote,
        myOtherChamberVote: null,
        canVoteOrigin: bill.status === "cabinet_review" && canVoteCabinetReview && myVote == null,
        canVoteOther: false,
        requiresExecutiveAction: billRequiresExecutiveAction(bill),
        failedAt: bill.failedAt?.toISOString() ?? null,
      };
    });

    return NextResponse.json({
      bills: billDisplays,
      proposalWarning,
      blockedProvisions,
      proposalAccess: {
        canPropose,
        allowedPolicyDomains,
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * POST — propose a cabinet bill.
 */
export async function POST(request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return errorResponse(400, "Invalid country code");
    }

    const config = getCountryConfig(countryId);
    if (!config.cabinetBillsEnabled) {
      return NextResponse.json(
        badRequest("Cabinet bills are not enabled for this country").toJson(),
        { status: 400 }
      );
    }

    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;
    const { character } = auth.user;

    // S#17 legislation freeze: block cabinet bill proposals while gov is pending.
    const freezeCheck = await checkLegislationFreeze(countryId);
    if (!freezeCheck.ok) return freezeCheck.response;

    const parsed = await parseJsonBody(request, proposeCabinetBillSchema);
    if (!parsed.success) {
      return errorResponse(parsed.status, parsed.error);
    }
    const {
      title,
      summary,
      fullText,
      legislationTypeId,
      policyOptionId,
      category,
      stateId,
      effectDirection,
      confirmElectionRisk,
    } = parsed.data;

    const db = await getDb();

    // Check that requester is PM or cabinet member
    const gov = await getGovernmentFormationsCollection(db).findOne({ _id: countryId });
    const isPM = gov?.pmCharacterId?.toString() === character._id.toString();

    // Cabinet member lookup — the unified cabinetMembers collection is the
    // single source across all countries. A player queries by their own id, so
    // NPP-held seats (null characterId) never match. All rows are loaded (not
    // findOne) so a dual-office holder proposes from the union of both
    // portfolios (issue #2049).
    const cabinetRows = !isPM
      ? await db
          .collection("cabinetMembers")
          .find({ characterId: character._id, countryId })
          .project({ positionId: 1 })
          .toArray()
      : [];

    if (!auth.user.isAdmin && !isPM && cabinetRows.length === 0) {
      return NextResponse.json(
        forbidden("Only the PM or cabinet members can propose cabinet bills").toJson(),
        { status: 403 }
      );
    }

    // Constraint 1: one active bill per sponsor in this country's national legislature (admins bypass)
    if (!auth.user.isAdmin) {
      const existingActiveBill = await db.collection<Bill>("bills").findOne({
        sponsorId: character._id,
        countryId,
        status: { $nin: NATIONAL_TERMINAL_STATUSES as BillStatus[] },
      });
      if (existingActiveBill) {
        return errorResponse(
          403,
          "You already have a bill in progress. Wait for it to pass, fail, or be signed before proposing another."
        );
      }
    }

    // Category restriction: cabinet members can only propose bills in their
    // positions' domains (union across both offices for a dual holder).
    // PM can propose any category
    if (!isPM && cabinetRows.length > 0) {
      const domainLists: string[][] = [];
      let mechanicsFound = false;
      for (const row of cabinetRows) {
        const positionId = (row as { positionId?: string }).positionId;
        const mechanics = positionId ? getCabinetMechanics(countryId, positionId) : undefined;
        if (mechanics) {
          mechanicsFound = true;
          domainLists.push(
            mechanics.legislativeDomains ?? mechanics.nationalMetrics.map((m) => m.category)
          );
        }
      }
      if (mechanicsFound) {
        const allowedDomains = new Set(unionLegislativeDomains(domainLists));
        // Look up the legislation type to check its category
        const legType = await db
          .collection<LegislationType>("legislationTypes")
          .findOne({ _id: legislationTypeId });
        if (legType) {
          const billDomain = legType.policyDomain;
          if (!allowedDomains.has(billDomain)) {
            return NextResponse.json(
              forbidden(
                `Your cabinet position only covers: ${[...allowedDomains].join(", ")}. This bill's domain (${billDomain}) is outside your portfolio.`
              ).toJson(),
              { status: 403 }
            );
          }
        }
      }
    }

    // Check limit: only 1 cabinet bill in "cabinet_review" at a time
    const existingReview = await db
      .collection<Bill>("bills")
      .findOne({ countryId, status: "cabinet_review", originChamber: "cabinet" });
    if (existingReview) {
      return NextResponse.json(badRequest("A cabinet bill is already under review").toJson(), {
        status: 400,
      });
    }

    // Check minimum 2 player-held cabinet positions (PM + at least 1 minister).
    // Counted as distinct characters (issue #2049): a dual-office holder's two
    // rows are one minister, and votes are keyed by character id, so a second
    // title never buys a second vote toward this quorum either.
    const playerHolderIds = await db
      .collection("cabinetMembers")
      .distinct("characterId", { countryId, characterId: { $ne: null } });
    const distinctPlayerHolders = new Set(
      playerHolderIds.filter((id) => id != null).map((id) => String(id))
    ).size;
    const totalPlayerPositions = (isPM ? 1 : 0) + distinctPlayerHolders;
    if (totalPlayerPositions < 2) {
      return NextResponse.json(
        badRequest("At least 2 player-held cabinet positions (including PM) are required").toJson(),
        { status: 400 }
      );
    }

    const rawResetLawProvisions = (parsed.data.provisions ?? []).filter(
      (provision): provision is { type: "reset_law" } =>
        typeof provision === "object" &&
        provision !== null &&
        "type" in provision &&
        provision.type === "reset_law"
    );
    const resetVersionState = await getGameState(db);
    const reviewedLegislationV2 =
      resetSystemVersionsForCountry(resetVersionState, RESET_V2_READY, countryId).legislation ===
      "v2";
    const reviewedCountryLegislation = reviewedLegislationV2 && isResetV2Country(countryId);
    const resetTaxes = reviewedCountryLegislation
      ? resetTaxesFor(countryId as ResetCountry, "national")
      : [];
    const resetTaxByTypeId = new Map(resetTaxes.map((tax) => [tax.existingLegislationTypeId, tax]));
    const rawResetTaxProvisions = (parsed.data.provisions ?? []).filter((provision) => {
      const legislationTypeId =
        typeof provision === "object" && provision !== null && "legislationTypeId" in provision
          ? String(provision.legislationTypeId)
          : "";
      return resetTaxByTypeId.has(legislationTypeId);
    });
    const rawReviewedProvisionCount = rawResetLawProvisions.length + rawResetTaxProvisions.length;
    if (rawResetLawProvisions.length > 0 && !reviewedCountryLegislation) {
      return errorResponse(409, "Legislation v2 is not enabled.");
    }
    if (reviewedCountryLegislation) {
      if (rawReviewedProvisionCount !== parsed.data.provisions?.length) {
        return NextResponse.json(
          badRequest(
            "A v2 cabinet bill can contain only reviewed law and tax provisions."
          ).toJson(),
          { status: 400 }
        );
      }
      const validated = await validateBillProvisions(
        db,
        parsed.data.provisions ?? [],
        category,
        countryId
      );
      if (!validated.ok) {
        return errorResponse(validated.status, validated.error);
      }
      const reviewedProvisionCount =
        validated.resetLawProvisions.length + validated.policyProvisions.length;
      if (reviewedProvisionCount === 0) {
        return NextResponse.json(
          badRequest("No reviewed law or tax provision was selected.").toJson(),
          { status: 400 }
        );
      }
      if (!isPM && !auth.user.isAdmin) {
        const heldSeats = new Set(
          cabinetRows
            .map((row) => (row as { positionId?: string }).positionId)
            .filter((positionId): positionId is string => Boolean(positionId))
        );
        const outsidePortfolio = validated.resetLawProvisions.find(
          (provision) =>
            !provision.overseeingSeatIdSnapshot ||
            !heldSeats.has(provision.overseeingSeatIdSnapshot)
        );
        const outsideTaxPortfolio = validated.policyProvisions.find((provision) => {
          const tax = resetTaxByTypeId.get(provision.legislationTypeId);
          return !tax?.overseeingSeatId || !heldSeats.has(tax.overseeingSeatId);
        });
        if (outsidePortfolio || outsideTaxPortfolio) {
          const title =
            outsidePortfolio?.titleSnapshot ??
            resetTaxByTypeId.get(outsideTaxPortfolio!.legislationTypeId)?.title ??
            "This tax instrument";
          return NextResponse.json(
            forbidden(`${title} is assigned to a different Cabinet portfolio.`).toJson(),
            { status: 403 }
          );
        }
      }
      const activeBillFilter = {
        countryId,
        status: { $nin: NATIONAL_TERMINAL_STATUSES as BillStatus[] },
      };
      const duplicateCheck = await checkDuplicateProvisions(
        db,
        "bills",
        activeBillFilter,
        validated.policyProvisions
      );
      if (duplicateCheck) {
        return errorResponse(409, duplicateCheck.error);
      }
      const resetLawDuplicateCheck = await checkDuplicateResetLawFamilies(
        db,
        "bills",
        activeBillFilter,
        validated.resetLawProvisions
      );
      if (resetLawDuplicateCheck) {
        return errorResponse(409, resetLawDuplicateCheck.error);
      }
      const now = new Date();
      const proposalWarning = await getBillProposalAutoFailWarning(db, countryId, "cabinet", now);
      if (proposalWarning && !confirmElectionRisk) {
        return errorResponse(409, getBillProposalAutoFailWarningError(proposalWarning), {
          extra: { autoFailWarning: proposalWarning, requiresElectionRiskConfirmation: true },
        });
      }
      const snapshottedTaxProvisions = await snapshotBillPolicyProvisions(
        db,
        { scope: "national", countryId },
        validated.policyProvisions
      );
      const npiCost = getProvisionCostTotal(reviewedProvisionCount);
      const actionCost = BILL_PROPOSE_ACTION_COST;
      if (!auth.user.isAdmin) {
        const spendResult = await db.collection<Character>("characters").updateOne(
          {
            _id: character._id,
            actions: { $gte: actionCost },
            ...(npiCost > 0 ? { nationalInfluence: { $gte: npiCost } } : {}),
          },
          {
            $inc: {
              actions: -actionCost,
              ...(npiCost > 0 ? { nationalInfluence: -npiCost } : {}),
            },
            $set: { updatedAt: now },
          }
        );
        if (spendResult.modifiedCount === 0) {
          return errorResponse(
            409,
            "Your actions or national influence changed. Please try again."
          );
        }
      }
      const votingEndsAt = new Date(now.getTime() + CABINET_VOTE_DURATION_MS);
      const firstTax = snapshottedTaxProvisions[0];
      const resetBill: Omit<Bill, "_id"> = {
        title,
        summary,
        fullText,
        category,
        provisions: [...snapshottedTaxProvisions, ...validated.resetLawProvisions],
        originChamber: "cabinet",
        currentChamber: config.legislature.lowerChamber.key,
        countryId,
        stateId: getNationalDocId(countryId) ?? `${countryId.toLowerCase()}_national`,
        ...(firstTax
          ? {
              legislationTypeId: firstTax.legislationTypeId,
              effectDirection: firstTax.effectDirection,
            }
          : {}),
        status: "cabinet_review",
        sponsorId: character._id,
        sponsorName: character.name,
        sponsorParty: character.party?.toString(),
        votesFor: 0,
        votesAgainst: 0,
        votesAbstain: 0,
        votes: {},
        votingStartedAt: now,
        votingEndsAt,
        ...(npiCost > 0 ? { proposalNpiCost: npiCost } : {}),
        ...(!auth.user.isAdmin ? { proposalActionCost: actionCost } : {}),
        proposedAt: now,
        createdAt: now,
        updatedAt: now,
      };
      try {
        const result = await db.collection<Bill>("bills").insertOne(resetBill as Bill);
        return NextResponse.json({
          success: true,
          billId: result.insertedId.toString(),
          votingEndsAt: votingEndsAt.toISOString(),
        });
      } catch (error) {
        if (!auth.user.isAdmin) {
          await db.collection<Character>("characters").updateOne(
            { _id: character._id },
            {
              $inc: {
                actions: actionCost,
                ...(npiCost > 0 ? { nationalInfluence: npiCost } : {}),
              },
              $set: { updatedAt: new Date() },
            }
          );
        }
        throw error;
      }
    }

    // ── State-ownership cabinet bills: multi-provision, shared-validated. ──
    if (
      NATIONALIZATION_BILL_CATEGORIES.has(
        category as Parameters<typeof NATIONALIZATION_BILL_CATEGORIES.has>[0]
      )
    ) {
      const natValidation = await validateNationalizationProvisions(
        db,
        parsed.data.provisions ?? [],
        countryId
      );
      if (!natValidation.ok) {
        return errorResponse(natValidation.status, natValidation.error);
      }

      const now = new Date();
      const proposalWarning = await getBillProposalAutoFailWarning(db, countryId, "cabinet", now);
      if (proposalWarning && !confirmElectionRisk) {
        return errorResponse(409, getBillProposalAutoFailWarningError(proposalWarning), {
          extra: { autoFailWarning: proposalWarning, requiresElectionRiskConfirmation: true },
        });
      }

      const npiCost = getProvisionCostTotal(natValidation.provisions.length);
      const actionCost = BILL_PROPOSE_ACTION_COST;
      if (!auth.user.isAdmin) {
        const freshChar = await db
          .collection<Character>("characters")
          .findOne({ _id: character._id });
        const currentActions = freshChar?.actions ?? 0;
        const liveNational = freshChar?.nationalInfluence ?? 0;
        if (currentActions < actionCost) {
          return errorResponse(
            400,
            `Proposing a bill costs ${actionCost} action points (you have ${currentActions}).`
          );
        }
        if (npiCost > 0 && liveNational < npiCost) {
          return errorResponse(
            400,
            `This bill costs ${npiCost} national political influence (you have ${liveNational.toFixed(0)}).`
          );
        }
        const spendResult = await db.collection<Character>("characters").updateOne(
          {
            _id: character._id,
            actions: { $gte: actionCost },
            ...(npiCost > 0 ? { nationalInfluence: { $gte: npiCost } } : {}),
          },
          {
            $inc: { actions: -actionCost, ...(npiCost > 0 ? { nationalInfluence: -npiCost } : {}) },
            $set: { updatedAt: new Date() },
          }
        );
        if (spendResult.modifiedCount === 0) {
          return errorResponse(
            409,
            "Your actions or national influence changed. Please try again."
          );
        }
      }

      const votingEndsAt = new Date(now.getTime() + CABINET_VOTE_DURATION_MS);
      const natBill: Omit<Bill, "_id"> = {
        title,
        summary,
        fullText,
        category,
        provisions: natValidation.provisions,
        originChamber: "cabinet",
        currentChamber: config.legislature.lowerChamber.key,
        countryId,
        stateId: stateId ?? undefined,
        status: "cabinet_review",
        sponsorId: character._id,
        sponsorName: character.name,
        sponsorParty: character.party?.toString(),
        votesFor: 0,
        votesAgainst: 0,
        votesAbstain: 0,
        votes: {},
        votingStartedAt: now,
        votingEndsAt,
        ...(npiCost > 0 ? { proposalNpiCost: npiCost } : {}),
        ...(!auth.user.isAdmin ? { proposalActionCost: actionCost } : {}),
        proposedAt: now,
        createdAt: now,
        updatedAt: now,
      };
      try {
        const result = await db.collection<Bill>("bills").insertOne(natBill as Bill);
        return NextResponse.json({
          success: true,
          billId: result.insertedId.toString(),
          votingEndsAt: votingEndsAt.toISOString(),
        });
      } catch (error) {
        if (!auth.user.isAdmin) {
          await db.collection<Character>("characters").updateOne(
            { _id: character._id },
            {
              $inc: { actions: actionCost, ...(npiCost > 0 ? { nationalInfluence: npiCost } : {}) },
              $set: { updatedAt: new Date() },
            }
          );
        }
        throw error;
      }
    }

    // Non-nationalization cabinet bills require a single legislation type.
    if (!legislationTypeId) {
      return NextResponse.json(badRequest("A legislation type is required.").toJson(), {
        status: 400,
      });
    }

    const selectedLegislationType = await db
      .collection<LegislationType>("legislationTypes")
      .findOne({ _id: legislationTypeId });
    if (!selectedLegislationType) {
      return NextResponse.json(badRequest("Unknown legislation type.").toJson(), {
        status: 400,
      });
    }
    const gameState = await getGameState(db);
    const administrationEnabled =
      gameState?.lawAdministrationEnabled === true && isResetV2Country(countryId);
    const administrationValidation = validateBillAdministration({
      enabled: administrationEnabled,
      legislationTypes: [selectedLegislationType],
    });
    if (!administrationValidation.ok) {
      return NextResponse.json(
        badRequest(administrationValidation.error ?? "Invalid administration metadata.").toJson(),
        { status: 400 }
      );
    }
    if (administrationEnabled) {
      const conflict = await findAdministrationConflict(db, countryId, [selectedLegislationType]);
      if (conflict) {
        return errorResponse(
          409,
          `This bill conflicts with active law ${conflict.existingLegislationTypeId} through ${conflict.conflictSetId}. Repeal or replace that regime first.`
        );
      }
    }

    // Build a synthetic provision for constraint checks (cabinet bills use a single legislationType)
    const cabinetProvision = policyOptionId
      ? [{ legislationTypeId, policyOptionId }]
      : [{ legislationTypeId }];

    // Constraint 2: no duplicate provision at same policy level across active national bills
    const duplicateCheck = await checkDuplicateProvisions(
      db,
      "bills",
      { countryId, status: { $nin: NATIONAL_TERMINAL_STATUSES as BillStatus[] } },
      cabinetProvision
    );
    if (duplicateCheck) {
      return errorResponse(409, duplicateCheck.error);
    }

    // Constraint 3: no proposing a law at its current active level
    const cabinetPolicyStoreId = stateId ?? `${countryId.toLowerCase()}_national`;
    const currentLevelCheck = await checkCurrentPolicyLevel(
      db,
      cabinetPolicyStoreId,
      cabinetProvision
    );
    if (currentLevelCheck) {
      return errorResponse(409, currentLevelCheck.error);
    }

    const now = new Date();
    const proposalWarning = await getBillProposalAutoFailWarning(db, countryId, "cabinet", now);
    if (proposalWarning && !confirmElectionRisk) {
      return errorResponse(409, getBillProposalAutoFailWarningError(proposalWarning), {
        extra: { autoFailWarning: proposalWarning, requiresElectionRiskConfirmation: true },
      });
    }

    // Cost deduction: action points + NPI for the single provision
    const npiCost = getProvisionCostTotal(1); // Cabinet bills always have 1 provision
    const actionCost = BILL_PROPOSE_ACTION_COST;
    if (!auth.user.isAdmin) {
      const freshChar = await db
        .collection<Character>("characters")
        .findOne({ _id: character._id });
      const currentActions = freshChar?.actions ?? 0;
      const liveNational = freshChar?.nationalInfluence ?? 0;
      if (currentActions < actionCost) {
        return errorResponse(
          400,
          `Proposing a bill costs ${actionCost} action points (you have ${currentActions}).`
        );
      }
      if (npiCost > 0 && liveNational < npiCost) {
        return errorResponse(
          400,
          `This bill costs ${npiCost} national political influence (you have ${liveNational.toFixed(0)}).`
        );
      }
      const spendResult = await db.collection<Character>("characters").updateOne(
        {
          _id: character._id,
          actions: { $gte: actionCost },
          ...(npiCost > 0 ? { nationalInfluence: { $gte: npiCost } } : {}),
        },
        {
          $inc: {
            actions: -actionCost,
            ...(npiCost > 0 ? { nationalInfluence: -npiCost } : {}),
          },
          $set: { updatedAt: new Date() },
        }
      );
      if (spendResult.modifiedCount === 0) {
        return errorResponse(409, "Your actions or national influence changed. Please try again.");
      }
    }

    const votingEndsAt = new Date(now.getTime() + CABINET_VOTE_DURATION_MS);

    const bill: Omit<Bill, "_id"> = {
      title,
      summary,
      fullText,
      legislationTypeId,
      category,
      provisions: [
        {
          legislationTypeId,
          ...(policyOptionId ? { policyOptionId } : {}),
          effectDirection,
        },
      ],
      originChamber: "cabinet",
      currentChamber: config.legislature.lowerChamber.key,
      countryId,
      stateId: stateId ?? undefined,
      status: "cabinet_review",
      effectDirection,
      sponsorId: character._id,
      sponsorName: character.name,
      sponsorParty: character.party?.toString(),
      votesFor: 0,
      votesAgainst: 0,
      votesAbstain: 0,
      votes: {},
      votingStartedAt: now,
      votingEndsAt,
      ...(npiCost > 0 ? { proposalNpiCost: npiCost } : {}),
      ...(!auth.user.isAdmin ? { proposalActionCost: actionCost } : {}),
      proposedAt: now,
      createdAt: now,
      updatedAt: now,
    };

    try {
      const result = await db.collection<Bill>("bills").insertOne(bill as Bill);
      return NextResponse.json({
        success: true,
        billId: result.insertedId.toString(),
        votingEndsAt: votingEndsAt.toISOString(),
      });
    } catch (error) {
      if (!auth.user.isAdmin) {
        await db.collection<Character>("characters").updateOne(
          { _id: character._id },
          {
            $inc: {
              actions: actionCost,
              ...(npiCost > 0 ? { nationalInfluence: npiCost } : {}),
            },
            $set: { updatedAt: new Date() },
          }
        );
      }
      throw error;
    }
  } catch (error) {
    return handleRouteError(error);
  }
}

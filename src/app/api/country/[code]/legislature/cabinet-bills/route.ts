// GET/POST /api/country/[code]/legislature/cabinet-bills — list or propose cabinet bills
// Auth: GET public, POST requireAuthWithCharacter (PM or cabinet member)
// Error codes: 400, 401, 403, 409
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { getAuthUser } from "@/lib/auth";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError, badRequest, forbidden } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { COUNTRY_CONFIGS, getCountryConfig, type CountryId } from "@/lib/constants/countries";
import { getGovernmentFormationsCollection } from "@/lib/db/collections/governmentFormation";
import { getCharacterByUserId } from "@/lib/db/characterLookup";
import { checkLegislationFreeze } from "@/lib/api/parliamentaryFreeze";
import { getCabinetMechanics } from "@/lib/constants/cabinetMechanics";
import type { BillDisplay } from "@/lib/legislature/dto/billDisplay";
import { getPartyHex, formatBillPositionLabel } from "@/lib/utils/politics";
import {
  directionLabel,
  effectTargetLabelFromMetricId,
  axisRelevant,
} from "@/lib/congress/billEnrichment";
import {
  checkDuplicateProvisions,
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
  NATIONALIZATION_BILL_CATEGORIES,
} from "@shared/constants/legislation";
import { validateNationalizationProvisions } from "@/lib/nationalization/billProvisionValidation";
import {
  getBillProposalAutoFailWarning,
  getBillProposalAutoFailWarningError,
} from "@/lib/legislature/billAutoFailWarning";
import { z } from "zod";
import { moderatedBillTitle, moderatedBillText } from "@/lib/api/schemas/congress";

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
  provisions: z.array(z.unknown()).optional(),
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
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }

    const config = getCountryConfig(countryId);
    if (!config.cabinetBillsEnabled) {
      return NextResponse.json({ bills: [] });
    }

    const db = await getDb();
    const [proposalWarning, authUser, gov, bills, activeBillsForProvisions, parties, legTypes] =
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
        db.collection<LegislationType>("legislationTypes").find({}).toArray(),
      ]);

    const partyMap = new Map(parties.map((party) => [String(party.sequentialId), party]));
    const legislationTypeMap = new Map(legTypes.map((lt) => [lt._id, lt]));

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
            const cabinetMember = await db.collection("cabinetMembers").findOne({
              characterId: character._id,
              countryId,
            });
            if (cabinetMember && !existingActiveBill) {
              canPropose = true;
              const positionId = (cabinetMember as { positionId?: string }).positionId;
              const mechanics = positionId ? getCabinetMechanics(countryId, positionId) : undefined;
              allowedPolicyDomains = mechanics
                ? [
                    ...new Set(
                      mechanics.legislativeDomains ??
                        mechanics.nationalMetrics.map((metric) => metric.category)
                    ),
                  ]
                : [];
            }
            canVoteCabinetReview = Boolean(cabinetMember);
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
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
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
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
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
    // NPP-held seats (null characterId) never match.
    const cabinetMember = !isPM
      ? await db.collection("cabinetMembers").findOne({ characterId: character._id, countryId })
      : null;

    if (!auth.user.isAdmin && !isPM && !cabinetMember) {
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
        return NextResponse.json(
          {
            error:
              "You already have a bill in progress. Wait for it to pass, fail, or be signed before proposing another.",
          },
          { status: 403 }
        );
      }
    }

    // Category restriction: cabinet members can only propose bills in their position's domains
    // PM can propose any category
    if (!isPM && cabinetMember) {
      const positionId = (cabinetMember as { positionId?: string }).positionId;
      if (positionId) {
        const mechanics = getCabinetMechanics(countryId, positionId);
        if (mechanics) {
          const allowedDomains = new Set(
            mechanics.legislativeDomains ?? mechanics.nationalMetrics.map((m) => m.category)
          );
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

    // Check minimum 2 player-held cabinet positions (PM + at least 1 minister)
    const playerCabinetCount = await db
      .collection("cabinetMembers")
      .countDocuments({ countryId, characterId: { $ne: null } });
    const totalPlayerPositions = (isPM ? 1 : 0) + playerCabinetCount;
    if (totalPlayerPositions < 2) {
      return NextResponse.json(
        badRequest("At least 2 player-held cabinet positions (including PM) are required").toJson(),
        { status: 400 }
      );
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
        return NextResponse.json({ error: natValidation.error }, { status: natValidation.status });
      }

      const now = new Date();
      const proposalWarning = await getBillProposalAutoFailWarning(db, countryId, "cabinet", now);
      if (proposalWarning && !confirmElectionRisk) {
        return NextResponse.json(
          {
            error: getBillProposalAutoFailWarningError(proposalWarning),
            autoFailWarning: proposalWarning,
            requiresElectionRiskConfirmation: true,
          },
          { status: 409 }
        );
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
          return NextResponse.json(
            {
              error: `Proposing a bill costs ${actionCost} action points (you have ${currentActions}).`,
            },
            { status: 400 }
          );
        }
        if (npiCost > 0 && liveNational < npiCost) {
          return NextResponse.json(
            {
              error: `This bill costs ${npiCost} national political influence (you have ${liveNational.toFixed(0)}).`,
            },
            { status: 400 }
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
          return NextResponse.json(
            { error: "Your actions or national influence changed. Please try again." },
            { status: 409 }
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
      return NextResponse.json({ error: duplicateCheck.error }, { status: 409 });
    }

    // Constraint 3: no proposing a law at its current active level
    const cabinetPolicyStoreId = stateId ?? `${countryId.toLowerCase()}_national`;
    const currentLevelCheck = await checkCurrentPolicyLevel(
      db,
      cabinetPolicyStoreId,
      cabinetProvision
    );
    if (currentLevelCheck) {
      return NextResponse.json({ error: currentLevelCheck.error }, { status: 409 });
    }

    const now = new Date();
    const proposalWarning = await getBillProposalAutoFailWarning(db, countryId, "cabinet", now);
    if (proposalWarning && !confirmElectionRisk) {
      return NextResponse.json(
        {
          error: getBillProposalAutoFailWarningError(proposalWarning),
          autoFailWarning: proposalWarning,
          requiresElectionRiskConfirmation: true,
        },
        { status: 409 }
      );
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
        return NextResponse.json(
          {
            error: `Proposing a bill costs ${actionCost} action points (you have ${currentActions}).`,
          },
          { status: 400 }
        );
      }
      if (npiCost > 0 && liveNational < npiCost) {
        return NextResponse.json(
          {
            error: `This bill costs ${npiCost} national political influence (you have ${liveNational.toFixed(0)}).`,
          },
          { status: 400 }
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
        return NextResponse.json(
          { error: "Your actions or national influence changed. Please try again." },
          { status: 409 }
        );
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

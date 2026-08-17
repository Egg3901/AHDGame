/**
 * GET /api/unions/[id] — union detail + the CorporateSectors currently
 * matching its (countryId, sectorType) scope (v3 Phase 8). Read-only, no
 * auth required — the dashboard UI decides what actions to show based on
 * whether the viewer leads this union. Gated on `labourSystemMode >= "full"`
 * (code-review fix #10/#13 — previously ungated, kept serving live union
 * data indefinitely even after the feature was disabled).
 */
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import type {
  Bill,
  BargainingCampaign,
  CollectiveAgreement,
  Corporation,
  CorporateSector,
  Union,
} from "@/lib/db/types";
import type { UnionEndorsement } from "@/lib/db/types/union";
import { CORPORATION_TYPE_LABELS } from "@/lib/constants/corporations";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import { isLabourFullMode } from "@/lib/labour/featureFlag";
import { reconcileUnionOwnerCache } from "@/lib/unions/unionReconciliation";
import {
  isUnionLeadershipElectionOpen,
  LEADERSHIP_ELECTION_MIN_STRENGTH,
  ORGANIZE_ACTION_COST,
  ORGANIZE_STRENGTH_GAIN,
  unionStrength,
} from "@/lib/unions/unionEconomy";
import { genericUnionName } from "@/lib/unions/unionNames";
import { getGameState } from "@/lib/gameState";
import { unionStrikeBlockReason } from "@/lib/unions/unionEconomy";
import { isUnionsBanned } from "@/lib/labour/unionLaws";
import { buildActiveNationalBillFilter } from "@/lib/legislature/nationalBillScope";
import { NATIONAL_TERMINAL_STATUSES } from "@/lib/congress/billProposalLimits";
import {
  buildBargainingEscalationPlan,
  getBargainingMediationAvailability,
  isCollectiveAgreementActive,
} from "@/lib/unions/bargaining";
import { buildRatificationView, ratificationBlockReason } from "@/lib/unions/ratification";
import { RATIFICATION_BALLOTS } from "@/lib/unions/commands/ratifySettlement";
import type { BargainingRatificationBallot } from "@/lib/db/types/union";
import { getAuthUserWithCharacter } from "@/lib/auth";
import type { PensionScheme } from "@/lib/db/types/pensionScheme";
import { PENSION_SCHEMES } from "@/lib/pensions/pensionTurn";
import {
  describeFundingBand,
  pensionFundingBand,
  pensionFundingRatio,
  pensionSchemeAssetsAnchor,
} from "@/lib/pensions/rules";
import {
  averageAnnualWage,
  duesIncomePerTurn,
  maxDuesForWage,
  servicesCostPerTurn,
  unionApproval,
  unionMembers,
} from "@/lib/unions/unionDues";
import { normalizeServiceIds } from "@/lib/unions/unionServices";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    if (!(await isLabourFullMode())) {
      return NextResponse.json({ error: "Player-run unions are not enabled." }, { status: 403 });
    }

    const { id } = await params;
    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid union ID" }, { status: 400 });
    }
    const db = await getDb();
    const union = await db.collection<Union>("unions").findOne({ _id: new ObjectId(id) });
    if (!union) {
      return NextResponse.json({ error: "Union not found" }, { status: 404 });
    }

    // Code-review fix #8: self-heal a desynced Character.unionLeaderOf cache
    // on read, rather than leaving it permanently stale.
    await reconcileUnionOwnerCache(db, union);

    const [
      sectors,
      endorsements,
      activeBills,
      gameState,
      activeAgreements,
      bargainingCampaigns,
      pensionScheme,
    ] = await Promise.all([
      db
        .collection<CorporateSector>("corporateSectors")
        .find(
          { countryId: union.countryId, sectorType: union.sectorType },
          {
            projection: {
              corporationId: 1,
              stateId: 1,
              wageLevel: 1,
              workers: 1,
              unionization: 1,
              wagePerWorker: 1,
              representingUnionId: 1,
              strikeStartedAtTurn: 1,
              strikeCooldownUntilTurn: 1,
            },
          }
        )
        .toArray(),
      db
        .collection<UnionEndorsement>("unionEndorsements")
        .find({ unionId: union._id })
        .sort({ createdAt: -1 })
        .toArray(),
      db
        .collection<Bill>("bills")
        .find(buildActiveNationalBillFilter(union.countryId, NATIONAL_TERMINAL_STATUSES), {
          projection: { title: 1, status: 1, proposedAt: 1 },
        })
        .sort({ proposedAt: -1 })
        .toArray(),
      getGameState(db),
      db
        .collection<CollectiveAgreement>("collectiveAgreements")
        .find(
          { unionId: union._id, status: "active" },
          {
            projection: {
              employerCorporationId: 1,
              sectorIds: 1,
              wageLevel: 1,
              startsAtTurn: 1,
              expiresAtTurn: 1,
              noStrikeUntilTurn: 1,
            },
          }
        )
        .toArray(),
      db
        .collection<BargainingCampaign>("bargainingCampaigns")
        .find({ unionId: union._id })
        .sort({ updatedAt: -1 })
        .limit(50)
        .toArray(),
      db.collection<PensionScheme>(PENSION_SCHEMES).findOne({ unionId: union._id }),
    ]);
    const currentTurn = gameState?.currentTurn ?? 0;

    // A8 phase 2: the funding ratio is TOTAL assets over liabilities, and total
    // assets are cash plus the marked value of the scheme's index-fund units.
    // Computed once here rather than inline four times, so the surface cannot
    // drift from the rule the top-up charge uses.
    const pensionSchemeView = pensionScheme
      ? (() => {
          const totalAssetsAnchor = pensionSchemeAssetsAnchor(pensionScheme);
          const fundingRatio = pensionFundingRatio(
            totalAssetsAnchor,
            pensionScheme.liabilitiesAnchor
          );
          const band = pensionFundingBand(fundingRatio);
          return {
            /** Cash only. `totalAssetsAnchor` is the number the ratio is built on. */
            assetsAnchor: pensionScheme.assetsAnchor,
            investedValueAnchor: pensionScheme.investedValueAnchor ?? 0,
            totalAssetsAnchor,
            liabilitiesAnchor: pensionScheme.liabilitiesAnchor,
            benefitsInPaymentAnchor: pensionScheme.benefitsInPaymentAnchor ?? 0,
            totalContributionsAnchor: pensionScheme.totalContributionsAnchor,
            totalTopUpsAnchor: pensionScheme.totalTopUpsAnchor,
            totalInvestedAnchor: pensionScheme.totalInvestedAnchor ?? 0,
            totalBenefitsPaidAnchor: pensionScheme.totalBenefitsPaidAnchor ?? 0,
            totalBenefitsUnpaidAnchor: pensionScheme.totalBenefitsUnpaidAnchor ?? 0,
            lastBenefitCutFraction: pensionScheme.lastBenefitCutFraction ?? 0,
            fundingRatio,
            band,
            explanation: describeFundingBand(band),
          };
        })()
      : null;
    const liveAgreements = activeAgreements.filter((agreement) =>
      isCollectiveAgreementActive(agreement, currentTurn)
    );
    const protectedSectorIds = new Set(
      liveAgreements
        .filter((agreement) => currentTurn < agreement.noStrikeUntilTurn)
        .flatMap((agreement) => agreement.sectorIds.map((sectorId) => sectorId.toString()))
    );
    // Player suggestion #93: a banned country's unions are frozen. Match the
    // list surfaces (`/api/unions/leaderboard`). A union seeded while a ban
    // was already enacted carries no `suspended` flag of its own, so the
    // country's budget flag is the source of truth either way.
    const suspended = union.suspended === true || (await isUnionsBanned(db, union.countryId));

    // Ratification ballots for the campaigns on this page. The route is public,
    // so the viewer is resolved optionally: an organizer sees their own weight
    // and their own ballot, everyone else sees only the tally. Same shape the
    // leadership vote route uses.
    const ratifyingCampaignIds = bargainingCampaigns
      .filter((campaign) => campaign.ratification)
      .map((campaign) => campaign._id);
    const [ratificationBallots, viewer] = await Promise.all([
      ratifyingCampaignIds.length
        ? db
            .collection<BargainingRatificationBallot>(RATIFICATION_BALLOTS)
            .find({ campaignId: { $in: ratifyingCampaignIds } })
            .toArray()
        : Promise.resolve([]),
      ratifyingCampaignIds.length ? getAuthUserWithCharacter() : Promise.resolve(null),
    ]);
    const viewerCharacterId = viewer?.character?._id ?? null;

    const corpIds = [...new Set(sectors.map((s) => s.corporationId.toString()))].map(
      (s) => new ObjectId(s)
    );
    const corps = corpIds.length
      ? await db
          .collection<Corporation>("corporations")
          .find({ _id: { $in: corpIds } }, { projection: { name: 1 } })
          .toArray()
      : [];
    const corpNameById = new Map(corps.map((c) => [c._id.toString(), c.name]));
    const sectorsByCorporation = new Map<string, typeof sectors>();
    for (const sector of sectors) {
      const key = sector.corporationId.toString();
      const group = sectorsByCorporation.get(key) ?? [];
      group.push(sector);
      sectorsByCorporation.set(key, group);
    }
    const openCampaignByEmployer = new Map(
      bargainingCampaigns
        .filter((campaign) => campaign.status === "negotiating" || campaign.status === "dispute")
        .map((campaign) => [campaign.employerCorporationId.toString(), campaign])
    );
    const agreementByEmployer = new Map(
      liveAgreements.map((agreement) => [agreement.employerCorporationId.toString(), agreement])
    );

    // Code-review fix #14: endorsements were a write-only dead end (recorded,
    // never surfaced anywhere). Join to bill titles and return them here so
    // the union's own dashboard can render "This union has endorsed/opposed: …".
    const billIds = endorsements.map((e) => e.billId);
    const bills = billIds.length
      ? await db
          .collection<Bill>("bills")
          .find({ _id: { $in: billIds } }, { projection: { title: 1 } })
          .toArray()
      : [];
    const billTitleById = new Map(bills.map((b) => [b._id!.toString(), b.title]));
    const stanceByBillId = new Map(
      endorsements.map((endorsement) => [endorsement.billId.toString(), endorsement.stance])
    );

    // Union dues v1: dues/services/approval are only ever priced against
    // sectors this union actually REPRESENTS (`representingUnionId` on the
    // sector), a strict subset of `sectors` above (which is every sector
    // matching the industry, still needed for bargaining/employer listings).
    const representedSectors = sectors.filter(
      (s) => s.representingUnionId?.toString() === union._id.toString()
    );
    const members = unionMembers(representedSectors);
    const annualWage = averageAnnualWage(representedSectors);
    const maxDuesPerWorkerAnnual = maxDuesForWage(annualWage);
    const duesPerWorkerAnnual = Math.min(
      Math.max(0, union.duesPerWorkerAnnual ?? 0),
      maxDuesPerWorkerAnnual
    );
    const activeServices = normalizeServiceIds(union.activeServices);

    return NextResponse.json({
      union: {
        id: union._id.toString(),
        name: union.name ?? genericUnionName(union.countryId, union.sectorType),
        countryId: union.countryId,
        countryName: COUNTRY_CONFIGS[union.countryId]?.name ?? union.countryId,
        sectorType: union.sectorType,
        sectorLabel: CORPORATION_TYPE_LABELS[union.sectorType] ?? union.sectorType,
        ownerId: union.ownerId?.toString() ?? null,
        pendingLeaderCharacterId: union.pendingLeaderCharacterId?.toString() ?? null,
        electionOpen: isUnionLeadershipElectionOpen(union),
        leadershipElectionMinStrength: LEADERSHIP_ELECTION_MIN_STRENGTH,
        strength: unionStrength(union),
        organizeActionCost: ORGANIZE_ACTION_COST,
        organizeStrengthGain: ORGANIZE_STRENGTH_GAIN,
        treasury: union.treasury,
        // Union dues v1 — replaces `membershipPressure`. `members` is a real
        // headcount (workers in represented sectors), `approval` is what
        // anchors unionization drift in those sectors.
        members,
        approval: unionApproval(union),
        duesPerWorkerAnnual,
        maxDuesPerWorkerAnnual,
        duesIncomePerTurn: duesIncomePerTurn(members, duesPerWorkerAnnual),
        activeServices,
        servicesCostPerTurn: servicesCostPerTurn(members, annualWage, activeServices),
        foundedByCharacterId: union.foundedByCharacterId?.toString() ?? null,
        demandedWageLevel: union.demandedWageLevel,
        suspended,
        currentTurn,
      },
      sectors: sectors.map((s) => ({
        sectorId: s._id.toString(),
        corporationId: s.corporationId.toString(),
        corporationName: corpNameById.get(s.corporationId.toString()) ?? "Unknown",
        stateId: s.stateId,
        wageLevel: s.wageLevel ?? 1,
        workers: s.workers ?? 0,
        wageGap:
          union.demandedWageLevel == null
            ? null
            : Math.round(Math.max(0, union.demandedWageLevel - (s.wageLevel ?? 1)) * 1000) / 1000,
        unionization: s.unionization ?? 0,
        // Union dues v1: which union (if any) currently holds this sector —
        // may be this union, a rival, or null (unrepresented, an
        // organize-sector target). See `POST .../organize-sector`.
        representingUnionId: s.representingUnionId?.toString() ?? null,
        strikeActive: s.strikeStartedAtTurn != null,
        strikeCooldownUntilTurn: s.strikeCooldownUntilTurn ?? null,
        strikeBlockReason: unionStrikeBlockReason(s, currentTurn, protectedSectorIds),
      })),
      // Union-wide membership: `unionization` is a percent (0-100) per sector, so
      // the covered headcount is Σ(workers × unionization/100). `density` is that
      // total over the whole workforce this union has standing in.
      workforce: (() => {
        const totalWorkers = sectors.reduce((sum, s) => sum + (s.workers ?? 0), 0);
        const unionizedWorkers = sectors.reduce(
          (sum, s) => sum + (s.workers ?? 0) * ((s.unionization ?? 0) / 100),
          0
        );
        return {
          totalWorkers: Math.round(totalWorkers),
          unionizedWorkers: Math.round(unionizedWorkers),
          density: totalWorkers > 0 ? unionizedWorkers / totalWorkers : 0,
        };
      })(),
      // No union-wide strike preview: unions no longer call strikes directly,
      // so the only live cost/eligibility figures are the campaign-scoped ones
      // in `bargainingCampaigns[].escalationPreview` below, which are built
      // from the same `strikeCallCost` and `STRIKE_CALL_MIN_UNIONIZATION`.
      agreements: liveAgreements.map((agreement) => ({
        agreementId: agreement._id.toString(),
        employerCorporationId: agreement.employerCorporationId.toString(),
        sectorIds: agreement.sectorIds.map((sectorId) => sectorId.toString()),
        wageLevel: agreement.wageLevel,
        startsAtTurn: agreement.startsAtTurn,
        expiresAtTurn: agreement.expiresAtTurn,
        noStrikeUntilTurn: agreement.noStrikeUntilTurn,
      })),
      employerOptions: [...sectorsByCorporation.entries()].map(([corporationId, locals]) => ({
        corporationId,
        corporationName: corpNameById.get(corporationId) ?? "Unknown",
        localCount: locals.length,
        averageWageLevel:
          locals.reduce((sum, local) => sum + (local.wageLevel ?? 1), 0) / locals.length,
        averageUnionization:
          locals.reduce((sum, local) => sum + (local.unionization ?? 0), 0) / locals.length,
        openCampaignId: openCampaignByEmployer.get(corporationId)?._id.toString() ?? null,
        agreementExpiresAtTurn: agreementByEmployer.get(corporationId)?.expiresAtTurn ?? null,
        agreementWageLevel: agreementByEmployer.get(corporationId)?.wageLevel ?? null,
        agreementNoStrikeUntilTurn:
          agreementByEmployer.get(corporationId)?.noStrikeUntilTurn ?? null,
      })),
      // A8: the union's pension scheme, absent entirely when it has never
      // bargained one. Absence is the honest record that it never won a pension,
      // rather than a row of zeroes that looks like a scheme with no money.
      pensionScheme: pensionSchemeView,
      bargainingCampaigns: bargainingCampaigns.map((campaign) => {
        const mediationAvailability = getBargainingMediationAvailability(campaign, currentTurn);
        // The union goes in so the preview carries the same refusals the
        // escalate command applies, notably the union-wide strike cooldown.
        const escalationPlan = buildBargainingEscalationPlan(campaign, sectors, currentTurn, union);
        return {
          campaignId: campaign._id.toString(),
          employerCorporationId: campaign.employerCorporationId.toString(),
          employerName:
            corpNameById.get(campaign.employerCorporationId.toString()) ?? "Unknown employer",
          status: campaign.status,
          escalationLevel: campaign.escalationLevel,
          // Always sent, whether or not there is a further level to escalate to,
          // so the panel never has to compute money the server owns.
          heldUpkeepPerTurn: escalationPlan.heldUpkeepPerTurn,
          escalationPreview: escalationPlan.nextLevel
            ? {
                nextLevel: escalationPlan.nextLevel,
                supportRequired: escalationPlan.supportRequired,
                cashCost: escalationPlan.cashCost,
                upkeepPerTurn: escalationPlan.upkeepPerTurn,
                strikeCooldownUntilTurn: escalationPlan.strikeCooldownUntilTurn,
                blockedReason: escalationPlan.blockedReason,
                newStrikeLocalCount: escalationPlan.newStrikeLocals.length,
                targetLocals: escalationPlan.affectedLocals.map((local) => ({
                  sectorId: local._id.toString(),
                  stateId: local.stateId,
                })),
              }
            : null,
          mediation: campaign.mediation ?? null,
          mediationAvailable: mediationAvailability.available,
          mediationUnavailableReason: mediationAvailability.reason,
          ratification: campaign.ratification
            ? buildRatificationView(
                campaign.ratification,
                ratificationBallots.filter((ballot) => ballot.campaignId.equals(campaign._id)),
                viewerCharacterId
              )
            : null,
          ratificationBlockedReason: ratificationBlockReason(campaign, currentTurn),
          currentOffer: campaign.currentOffer,
          offers: campaign.offers,
          mandate: campaign.mandate,
          sectorCount: campaign.sectorIds.length,
          startedAtTurn: campaign.startedAtTurn,
          deadlineTurn: campaign.deadlineTurn,
          lastActionTurn: campaign.lastActionTurn,
          disputeStartedAtTurn: campaign.disputeStartedAtTurn ?? null,
          mediationAvailableTurn: mediationAvailability.availableTurn,
          endedAtTurn: campaign.endedAtTurn ?? null,
        };
      }),
      actionableBills: activeBills.map((bill) => ({
        billId: bill._id.toString(),
        billTitle: bill.title,
        status: bill.status,
        stance: stanceByBillId.get(bill._id.toString()) ?? null,
      })),
      endorsements: endorsements.map((e) => ({
        billId: e.billId.toString(),
        billTitle: billTitleById.get(e.billId.toString()) ?? "Unknown bill",
        stance: e.stance,
        createdAt: e.createdAt,
      })),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

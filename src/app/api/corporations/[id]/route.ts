import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { resolveCorporation } from "@/lib/api/corporations/resolveQuery";
import { getGameState } from "@/lib/gameState";
import { getAuthUser } from "@/lib/auth";
import { loadCorporationDetailView } from "@/lib/corporations/queries/corporationDetail";
import { loadCorporationDefenceContracts } from "@/lib/corporations/queries/corporationDefenceContracts";
import { resolveGameYear } from "@/lib/era/era";
import {
  shouldRedactCorporation,
  redactPrivateCorporation,
  redactPrivateSectorRow,
} from "@/lib/corporations/redaction";
import type { CorporationPrivatizationVote, Corporation, CorporationHistory } from "@/lib/db/types";
import {
  getFogFactor,
  applyFogToFinancials,
  applyFogToBalanceSheet,
  applyFogToSectorPhysicals,
  getSectorPhysicalsFogFactors,
  buildQuarterlySnapshot,
  FINANCIAL_FOG_QUARTER_TURNS,
  FINANCIAL_FOG_MAX_DEVIATION,
} from "@/lib/corporations/financialFogOfWar";
import type { FinancialFogMeta } from "@/lib/corporations/financialFogOfWar";
import type { GameConfig } from "@/lib/db/types/gameConfig";
import { FINANCIAL_DISTRESS_GRACE_TURNS } from "@/lib/nationalization/constants";
import { isContractIssuanceEnabled } from "@/lib/extraction/featureFlag";
import { buildCorpNationalizationThreat } from "@/lib/nationalization/corpNationalizationThreat";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/** Narrow an untyped payload value to a finite number, else null. */
function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// GET /api/corporations/[id] — Return the corporation detail payload for the corporation page.
// Auth: public
// Errors: 400, 404
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    const db = await getDb();
    const [gameState, config, resolved, authUser] = await Promise.all([
      getGameState(),
      // Private supply-agreements gate — a governor-set gameConfig flag ("default"
      // doc), surfaced on the corp payload so the CEO panel can show/hide without
      // an extra round-trip.
      db
        .collection<GameConfig>("gameConfig")
        .findOne(
          { _id: "default" },
          { projection: { supplyAgreementsEnabled: 1, contractIssuanceEnabled: 1 } }
        ),
      resolveCorporation(db, id),
      getAuthUser().catch(() => null),
    ]);
    const currentTurn = gameState?.currentTurn ?? 0;
    // Global, non-sensitive feature flag — surfaced on the corp payload so the
    // page can show/hide the Tech tab without an extra round-trip.
    const techTreesEnabled = gameState?.sectorTechTreesEnabled === true;
    const supplyAgreementsEnabled = config?.supplyAgreementsEnabled === true;
    // Extraction-contract gate — surfaced on the corp payload so the Contracts
    // tab (offers / active contracts) can show/hide without an extra round-trip.
    const contractIssuanceEnabled = await isContractIssuanceEnabled(config);

    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;
    const modViewEnabled =
      !authUser?.isAdmin &&
      authUser?.isModerator === true &&
      new URL(request.url).searchParams.get("modView") === "1";
    const detail = (await loadCorporationDetailView({
      db,
      corporation,
      currentTurn,
      viewerUserId: authUser?.userId ?? null,
    })) as Record<string, unknown>;

    // Surface any open privatization vote so the corp page can mount the panel.
    // Must be nested inside `corporation` — the page sets state from data.corporation,
    // so a top-level openPrivatizationVoteId would be silently ignored.
    const openVote = await db
      .collection<CorporationPrivatizationVote>("corporationPrivatizationVotes")
      .findOne({ corporationId: corporation._id, status: "open" }, { projection: { _id: 1 } });

    const openPrivatizationVoteId = openVote?._id?.toString() ?? null;
    (detail.corporation as Record<string, unknown>).openPrivatizationVoteId =
      openPrivatizationVoteId;

    // Public nationalization-risk surface (player corps only). Derived from the
    // financial-distress clock; intentionally NOT redacted/fogged so the at-risk
    // badge is visible to every viewer on public and private corps alike.
    const sinceTurn = corporation.financialDistressSinceTurn;
    const nationalizationRisk =
      sinceTurn != null && corporation.userId != null && !corporation.countryOwnerId
        ? {
            sinceTurn,
            turnsUntilEligible: Math.max(
              0,
              FINANCIAL_DISTRESS_GRACE_TURNS - (currentTurn - sinceTurn)
            ),
          }
        : null;
    (detail.corporation as Record<string, unknown>).nationalizationRisk = nationalizationRisk;

    // Public legislative-nationalization threat (non-state corps): pending takings
    // and/or bills in voting that target the corp or its sectors. Like the risk
    // surface above, NOT redacted/fogged — it is public legislative information.
    const nationalizationThreat = corporation.countryOwnerId
      ? null
      : await buildCorpNationalizationThreat(db, corporation, currentTurn);
    (detail.corporation as Record<string, unknown>).nationalizationThreat = nationalizationThreat;
    (detail.corporation as Record<string, unknown>).techTreesEnabled = techTreesEnabled;
    (detail.corporation as Record<string, unknown>).supplyAgreementsEnabled =
      supplyAgreementsEnabled;
    (detail.corporation as Record<string, unknown>).contractIssuanceEnabled =
      contractIssuanceEnabled;

    let redact = shouldRedactCorporation(
      corporation,
      authUser?.userId ?? undefined,
      authUser?.isAdmin === true,
      modViewEnabled
    );

    if (redact && authUser?.userId) {
      // Controlling parent CEO is an insider of a private subsidiary.
      const parentInfo = (detail.corporation as Record<string, unknown>).parentCorporation as
        { _id: string } | null | undefined;
      if (parentInfo?._id && ObjectId.isValid(parentInfo._id)) {
        const parentCorp = await db
          .collection<Corporation>("corporations")
          .findOne(
            { _id: new ObjectId(parentInfo._id) },
            { projection: { userId: 1, ceoVacant: 1 } }
          );
        if (
          parentCorp &&
          parentCorp.ceoVacant !== true &&
          parentCorp.userId?.toString() === authUser.userId
        ) {
          redact = false;
        }
      }
    }

    if (redact) {
      // Sensitive financial fields live nested under `corporation`, `financials`,
      // `sectors`, and `balanceSheet`. Strip each appropriately rather than the
      // top-level wrapper. Reflects the same redaction rule used by the directory.
      const innerCorp = (detail.corporation as Record<string, unknown>) ?? {};
      const sectors = Array.isArray(detail.sectors)
        ? (detail.sectors as Array<Record<string, unknown>>).map((s) => redactPrivateSectorRow(s))
        : [];
      return NextResponse.json({
        corporation: {
          ...redactPrivateCorporation(innerCorp),
          openPrivatizationVoteId,
          nationalizationRisk,
          nationalizationThreat,
          techTreesEnabled,
          supplyAgreementsEnabled,
          contractIssuanceEnabled,
        },
        ceo: detail.ceo,
        ceoIsInactive: detail.ceoIsInactive,
        // Drop entire financials and balance sheet — they are pure financial signal.
        financials: null,
        sectors,
        balanceSheet: null,
        isPrivate: true,
      });
    }

    // Financial fog of war — public corps only, non-insider viewers.
    // CEO and CEO of controlling parent see live data; everyone else gets the
    // last quarterly snapshot ± a deterministic ±0-10% estimate.
    const isNatcorp = !!corporation.countryOwnerId;
    const isPublicCorp = !corporation.isPrivate && !isNatcorp;

    let financialFogMeta: FinancialFogMeta | null = null;

    if (isPublicCorp) {
      let isInsider = authUser?.isAdmin === true;

      if (!isInsider && authUser) {
        // Viewer is the CEO of this corp if the corp's userId matches.
        isInsider = corporation.userId?.toString() === authUser.userId;

        // Check if viewer is CEO of the controlling parent (sees through fog).
        if (!isInsider) {
          const corpDetail = detail.corporation as Record<string, unknown>;
          const parentInfo = corpDetail?.parentCorporation as { _id: string } | null | undefined;
          if (parentInfo?._id && ObjectId.isValid(parentInfo._id)) {
            const parentCorp = await db
              .collection<Corporation>("corporations")
              .findOne(
                { _id: new ObjectId(parentInfo._id) },
                { projection: { userId: 1, ceoVacant: 1 } }
              );
            isInsider =
              !!parentCorp &&
              !parentCorp.ceoVacant &&
              parentCorp.userId?.toString() === authUser.userId;
          }
        }
      }

      if (!isInsider) {
        // Last completed quarter boundary turn (turns divisible by FINANCIAL_FOG_QUARTER_TURNS).
        const quarterBoundaryTurn =
          Math.floor(currentTurn / FINANCIAL_FOG_QUARTER_TURNS) * FINANCIAL_FOG_QUARTER_TURNS;
        const fogSourceTurn = Math.max(0, quarterBoundaryTurn - FINANCIAL_FOG_QUARTER_TURNS);

        // Fetch the quarterly history snapshot (most recent turn <= fogSourceTurn).
        const historySnap =
          fogSourceTurn > 0
            ? await db
                .collection<CorporationHistory>("corporationHistory")
                .findOne(
                  { corporationId: corporation._id, turn: { $lte: fogSourceTurn } },
                  { sort: { turn: -1 } }
                )
            : null;

        const factor = getFogFactor(corporation._id.toString(), currentTurn);
        // C3: produced/sold get their own independent draws — see
        // `getSectorPhysicalsFogFactors`.
        const physicalFactors = getSectorPhysicalsFogFactors(
          corporation._id.toString(),
          currentTurn
        );
        const quarterly = buildQuarterlySnapshot(historySnap);

        financialFogMeta = {
          isFinancialFogOfWar: true,
          fogSourceTurn: quarterly.turn,
          // C3: the multiplier itself is never published — only its envelope.
          maxDeviation: FINANCIAL_FOG_MAX_DEVIATION,
          lastQuarterly: quarterly,
        };

        // Replace live financials and balance sheet with fogged estimates.
        if (detail.financials) {
          detail.financials = applyFogToFinancials(
            detail.financials as Parameters<typeof applyFogToFinancials>[0],
            factor
          );
        }
        if (detail.balanceSheet) {
          detail.balanceSheet = applyFogToBalanceSheet(
            detail.balanceSheet as Parameters<typeof applyFogToBalanceSheet>[0],
            factor
          );
        }
        // Also fog the liquidCapital shown on the corporation summary.
        const corpObj = detail.corporation as Record<string, unknown>;
        if (corpObj && typeof corpObj.liquidCapital === "number") {
          corpObj.liquidCapital = Math.round(corpObj.liquidCapital * factor);
        }

        // Plants tier: the physical figures are financials too. Capacity,
        // output, sales and construction-in-progress get the same quarterly
        // perturbation the money lines do — otherwise a rival reads exact
        // capacity off a corp whose revenue is deliberately blurred, and the
        // blur is worthless (revenue is derived from capacity under plants).
        //
        // The exact FILL RATE is stripped entirely rather than perturbed. It
        // is a ratio, so a uniform fog leaves it untouched, and it is the one
        // number that tells an attacker the incumbent cannot defend. Outsiders
        // keep only the coarse band.
        //
        // C3: `buildQueueSummary` is DROPPED rather than perturbed. It carries
        // the raw `unitsOrdered` for every outstanding order, sitting next to a
        // fogged corp-level `unitsOnOrder` — so summing the raw per-sector rows
        // and dividing recovers the fog factor itself, and with it every other
        // fogged number on the payload. It also publishes exact delivery turns,
        // which is future capacity intel the money fog has no analogue for.
        // Insiders (CEO, controlling parent, admin) never reach this branch and
        // keep the full queue.
        const foggedSectors = detail.sectors as Record<string, unknown>[] | undefined;
        if (Array.isArray(foggedSectors)) {
          for (const row of foggedSectors) {
            const fogged = applyFogToSectorPhysicals(
              {
                capacityUnits: numberOrNull(row.capacityUnits),
                producedUnits: numberOrNull(row.producedUnits),
                soldUnits: numberOrNull(row.soldUnits),
                constructionInProgressAnchor: numberOrNull(row.constructionInProgressAnchor),
              },
              physicalFactors
            );
            Object.assign(row, fogged);
            row.buildQueueSummary = null;
            // A ratio: the uniform money fog cancels out of it, so perturbing
            // is pointless and publishing it exact hands an outsider the
            // profit-to-cost position the fog exists to blur. Insider-only,
            // like the exact fill rate.
            row.fillAdjustedMarginPct = null;
            // Also a ratio, and the same class of intel as the exact fill rate:
            // it names which of this corp's plants cannot reach their market.
            // The class goes with it: `redaction.ts` treats the pair as one
            // secret, and leaving the class behind would publish WHY a fogged
            // plant is stranded while withholding only the magnitude.
            row.deliveryLimitedFraction = null;
            row.deliveryLimitedFreightClass = null;
          }
        }
        const corpPhysical = corpObj?.physical as Record<string, unknown> | null | undefined;
        if (corpPhysical) {
          Object.assign(
            corpPhysical,
            applyFogToSectorPhysicals(
              {
                capacityUnits: numberOrNull(corpPhysical.capacityUnits),
                producedUnits: numberOrNull(corpPhysical.producedUnits),
                soldUnits: numberOrNull(corpPhysical.soldUnits),
                constructionInProgressAnchor: numberOrNull(
                  corpPhysical.constructionInProgressAnchor
                ),
              },
              physicalFactors
            )
          );
          // Own draw again: sharing `base` with capacity/CIP would publish the
          // exact on-order-to-capacity ratio.
          corpPhysical.unitsOnOrder = Math.round(
            (numberOrNull(corpPhysical.unitsOnOrder) ?? 0) *
              getFogFactor(corporation._id.toString(), currentTurn, "onOrder")
          );
        }
      }
    }

    // Procurement position: what the state has contracted this corporation to build, and
    // the grade ceiling its R&D puts on what it can deliver. PUBLIC, like the rest of the
    // detail payload — a nation's arms suppliers are not a secret, and the CEO's own view
    // of it is what makes the defence tech tree worth investing in.
    const defence = await loadCorporationDefenceContracts(
      db,
      corporation._id,
      resolveGameYear(gameState ?? {}) ?? 0
    );

    return NextResponse.json({
      ...detail,
      isPrivate: corporation.isPrivate ?? false,
      financialFogOfWar: financialFogMeta,
      defenceContracts: defence,
    });
  } catch (error) {
    return handleRouteError(error, { request, route: "/api/corporations/[id]" });
  }
}

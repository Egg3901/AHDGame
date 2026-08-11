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
import type { Bill, Corporation, CorporateSector, Union } from "@/lib/db/types";
import type { UnionEndorsement } from "@/lib/db/types/union";
import { CORPORATION_TYPE_LABELS } from "@/lib/constants/corporations";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import { isLabourFullMode } from "@/lib/labour/featureFlag";
import { reconcileUnionOwnerCache } from "@/lib/unions/unionReconciliation";
import {
  isUnionLeadershipElectionOpen,
  LEADERSHIP_ELECTION_MIN_PRESSURE,
} from "@/lib/unions/unionEconomy";
import { genericUnionName } from "@/lib/unions/unionNames";

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

    const sectors = await db
      .collection<CorporateSector>("corporateSectors")
      .find(
        { countryId: union.countryId, sectorType: union.sectorType },
        {
          projection: {
            corporationId: 1,
            stateId: 1,
            unionization: 1,
            strikeStartedAtTurn: 1,
            strikeCooldownUntilTurn: 1,
          },
        }
      )
      .toArray();

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

    // Code-review fix #14: endorsements were a write-only dead end (recorded,
    // never surfaced anywhere). Join to bill titles and return them here so
    // the union's own dashboard can render "This union has endorsed/opposed: …".
    const endorsements = await db
      .collection<UnionEndorsement>("unionEndorsements")
      .find({ unionId: union._id })
      .sort({ createdAt: -1 })
      .toArray();
    const billIds = endorsements.map((e) => e.billId);
    const bills = billIds.length
      ? await db
          .collection<Bill>("bills")
          .find({ _id: { $in: billIds } }, { projection: { title: 1 } })
          .toArray()
      : [];
    const billTitleById = new Map(bills.map((b) => [b._id!.toString(), b.title]));

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
        leadershipElectionMinPressure: LEADERSHIP_ELECTION_MIN_PRESSURE,
        treasury: union.treasury,
        membershipPressure: union.membershipPressure,
        demandedWageLevel: union.demandedWageLevel,
        lastCalledStrikeTurn: union.lastCalledStrikeTurn,
      },
      sectors: sectors.map((s) => ({
        sectorId: s._id.toString(),
        corporationId: s.corporationId.toString(),
        corporationName: corpNameById.get(s.corporationId.toString()) ?? "Unknown",
        stateId: s.stateId,
        unionization: s.unionization ?? 0,
        strikeActive: s.strikeStartedAtTurn != null,
        strikeCooldownUntilTurn: s.strikeCooldownUntilTurn ?? null,
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

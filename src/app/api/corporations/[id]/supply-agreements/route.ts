import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { getAuthUser } from "@/lib/auth";
import { proposeSupplyAgreement } from "@/lib/corporations/commands/supplyAgreements";
import { corporationQueryFromParamId } from "@/lib/api/corporations/resolveQuery";
import type { SupplyAgreement } from "@/lib/db/types/supplyAgreement";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/** GET — list this corp's supply agreements (as supplier or buyer). */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    const corpQuery = corporationQueryFromParamId(id);
    if (!corpQuery) {
      return NextResponse.json({ error: "Invalid corporation id" }, { status: 400 });
    }
    const db = await getDb();
    const corp = await db.collection("corporations").findOne(corpQuery, { projection: { _id: 1 } });
    if (!corp) {
      return NextResponse.json({ error: "Corporation not found" }, { status: 404 });
    }
    const corpId = corp._id;
    const agreements = await db
      .collection<SupplyAgreement>("supplyAgreements")
      .find({ $or: [{ supplierCorpId: corpId }, { buyerCorpId: corpId }] })
      .sort({ updatedAt: -1 })
      .toArray();
    const counterpartyIds = [
      ...new Set(
        agreements.flatMap((agreement) => [
          agreement.supplierCorpId.toString(),
          agreement.buyerCorpId.toString(),
        ])
      ),
    ];
    const counterparties =
      counterpartyIds.length > 0
        ? await db
            .collection("corporations")
            .find({
              _id: { $in: counterpartyIds.map((counterpartyId) => new ObjectId(counterpartyId)) },
            })
            .project<{ _id: ObjectId; name: string; ticker?: string | null }>({
              name: 1,
              ticker: 1,
            })
            .toArray()
        : [];
    const counterpartyById = new Map(
      counterparties.map((counterparty) => [counterparty._id.toString(), counterparty])
    );
    return NextResponse.json({
      agreements: agreements.map((a) => ({
        supplierCorpName:
          counterpartyById.get(a.supplierCorpId.toString())?.name ?? "Unknown corporation",
        supplierCorpTicker: counterpartyById.get(a.supplierCorpId.toString())?.ticker ?? null,
        buyerCorpName:
          counterpartyById.get(a.buyerCorpId.toString())?.name ?? "Unknown corporation",
        buyerCorpTicker: counterpartyById.get(a.buyerCorpId.toString())?.ticker ?? null,
        ...a,
        _id: a._id?.toString(),
        supplierCorpId: a.supplierCorpId.toString(),
        buyerCorpId: a.buyerCorpId.toString(),
        proposedByCorpId: a.proposedByCorpId.toString(),
      })),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

/** POST — propose a new supply agreement (supplier CEO). */
export async function POST(request: Request, { params }: RouteParams) {
  const { id } = await params;
  // Auth is enforced inside proposeSupplyAgreement (CEO check).
  void getAuthUser;
  return proposeSupplyAgreement(request, id);
}

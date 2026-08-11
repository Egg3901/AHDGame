import { NextResponse } from "next/server";
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
    return NextResponse.json({
      agreements: agreements.map((a) => ({
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

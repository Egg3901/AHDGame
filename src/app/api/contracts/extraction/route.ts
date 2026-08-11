// GET ?stateId= | ?corporationId= | ?resource= | ?countryId= | ?status= — list contracts (public)
//   status absent  → active-only (capacity-allocating; legacy behavior, unchanged)
//   status=offered → pending offers only (non-revoked)
//   status=all     → full history incl. offered/declined/expired/defaulted/revoked
// POST — grant a contract (admin only)

import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { z } from "zod";
import { EXTRACTABLE_RESOURCES } from "@/lib/constants/commodities";
import { ZOD_COUNTRY_ENUM } from "@/lib/constants/countries";
import { getAuthUser } from "@/lib/auth";
import type { ExtractionContract } from "@/lib/db/types/extractionContract";
import { activeExtractionContractFilter } from "@/lib/db/collections/extractionContracts";
import { isContractIssuanceEnabled } from "@/lib/extraction/featureFlag";
import type { Corporation } from "@/lib/db/types/corporation";
import type { GameState } from "@/lib/db/types/gameState";

const grantSchema = z.object({
  stateId: z.string().min(1),
  // Required to scope state-ID resolution across cross-country collisions
  // (e.g. CN HB / DE HB). Callers must supply the country of the state.
  countryId: z.enum(ZOD_COUNTRY_ENUM),
  corporationId: z.string().length(24),
  resource: z.enum(EXTRACTABLE_RESOURCES),
  share: z.number().min(0.01).max(1.0),
  grantedBy: z.string().min(1),
  grantedByLevel: z.enum(["state", "national"]),
  force: z.boolean().optional(),
});

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const stateId = searchParams.get("stateId");
    const corporationId = searchParams.get("corporationId");
    const resource = searchParams.get("resource");
    const countryId = searchParams.get("countryId");
    const status = searchParams.get("status");

    if (corporationId && !ObjectId.isValid(corporationId)) {
      return NextResponse.json({ error: "Invalid corporationId" }, { status: 400 });
    }
    if (status && status !== "offered" && status !== "all") {
      return NextResponse.json({ error: "Invalid status filter" }, { status: 400 });
    }

    const db = await getDb();
    // Default: only capacity-allocating contracts — non-revoked and not offered /
    // declined (absent status = legacy active) — so every existing consumer keeps
    // its behavior. `status=offered` surfaces pending (non-revoked) offers for
    // the Congress / corp offer panels; `status=all` returns the full history
    // (offers + active + terminal states) for the corp Contracts tab.
    const query: Record<string, unknown> =
      status === "all"
        ? {}
        : status === "offered"
          ? { status: "offered", revokedTurn: { $exists: false } }
          : { ...activeExtractionContractFilter() };
    if (stateId) query.stateId = stateId;
    if (corporationId) query.corporationId = new ObjectId(corporationId);
    if (resource) query.resource = resource;
    if (countryId) query.countryId = countryId;

    const contracts = await db
      .collection<ExtractionContract>("extractionContracts")
      .find(query)
      .toArray();

    const corpIds = [...new Set(contracts.map((c) => c.corporationId as ObjectId))];
    const corporations =
      corpIds.length > 0
        ? await db
            .collection<Corporation>("corporations")
            .find({ _id: { $in: corpIds } }, { projection: { name: 1, userId: 1 } })
            .toArray()
        : [];
    const corpNames = new Map(corporations.map((c) => [c._id.toString(), c.name]));
    const corpOwnerIds = new Map(corporations.map((c) => [c._id.toString(), c.userId?.toString()]));

    // Optional-auth read: contract terms (share/royalty/term/fee) are the
    // public record of a government contract, but missedPayments is private
    // financial-distress signal — only the corp's CEO (who needs it for the
    // default warning) and admins see it.
    const authUser = await getAuthUser().catch(() => null);
    const isAdmin = authUser?.isAdmin === true;

    return NextResponse.json({
      // Per-surface flag convention: the Congress Contracts tab (and other list
      // consumers) read the issuance gate off this payload.
      contractIssuanceEnabled: await isContractIssuanceEnabled(),
      contracts: contracts.map((c) => {
        const id = (c.corporationId as ObjectId).toString();
        const { missedPayments, ...rest } = c;
        const viewerIsCeo =
          authUser != null &&
          corpOwnerIds.get(id) != null &&
          corpOwnerIds.get(id) === authUser.userId;
        return {
          ...rest,
          _id: c._id.toString(),
          corporationId: id,
          corporationName: corpNames.get(id),
          ...(isAdmin || viewerIsCeo ? { missedPayments } : {}),
        };
      }),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, grantSchema);
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });

    const { stateId, countryId, corporationId, resource, share, grantedBy, grantedByLevel, force } =
      parsed.data;

    const db = await getDb();

    const existing = await db
      .collection<ExtractionContract>("extractionContracts")
      .find({ stateId, resource, revokedTurn: { $exists: false } })
      .toArray();
    const currentTotal = existing.reduce((sum, c) => sum + (c.share ?? 0), 0);
    const overAllocated = currentTotal + share > 1.0;

    // Require explicit force:true before inserting an over-allocated contract
    if (overAllocated && !force) {
      return NextResponse.json({ overAllocated: true, needsConfirmation: true }, { status: 409 });
    }

    const gameState = await db.collection<GameState>("gameState").findOne({ _id: "current" });
    const currentTurn = gameState?.currentTurn ?? 0;

    const result = await db.collection("extractionContracts").insertOne({
      stateId,
      countryId,
      corporationId: new ObjectId(corporationId),
      resource,
      share,
      grantedTurn: currentTurn,
      grantedBy,
      grantedByLevel,
      updatedAt: new Date(),
    });

    return NextResponse.json({ success: true, contractId: result.insertedId.toString() });
  } catch (error) {
    return handleRouteError(error);
  }
}

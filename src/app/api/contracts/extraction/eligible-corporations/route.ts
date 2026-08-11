// GET /api/contracts/extraction/eligible-corporations?stateId=&resource= - Extraction corps in a state.
// Auth: public read (used by the contract-issuance corp picker; no ObjectId input).
// Errors: 400

import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { handleRouteError, badRequest } from "@/lib/api/errors";
import { EXTRACTABLE_RESOURCES } from "@/lib/constants/commodities";
import type { Corporation, CorporateSector } from "@/lib/db/types";
import type { Character } from "@/lib/db/types/character";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const stateId = searchParams.get("stateId");
    const resource = searchParams.get("resource");
    if (!stateId) throw badRequest("stateId is required");
    if (resource && !EXTRACTABLE_RESOURCES.includes(resource as never)) {
      throw badRequest("Invalid resource");
    }

    const db = await getDb();

    const sectors = await db
      .collection<CorporateSector>("corporateSectors")
      .find({ stateId }, { projection: { corporationId: 1 } })
      .toArray();
    const corpIds = [...new Set(sectors.map((s) => s.corporationId.toString()))].map(
      (id) => new ObjectId(id)
    );
    if (corpIds.length === 0) return NextResponse.json({ corporations: [] });

    const corps = await db
      .collection<Corporation>("corporations")
      .find({ _id: { $in: corpIds }, type: "extraction" }, { projection: { name: 1, ceoId: 1 } })
      .toArray();

    const ceoIds = corps.map((c) => c.ceoId).filter((id): id is ObjectId => id instanceof ObjectId);
    const ceoNameById = new Map<string, string>();
    if (ceoIds.length > 0) {
      const chars = await db
        .collection<Character>("characters")
        .find({ _id: { $in: ceoIds } }, { projection: { name: 1 } })
        .toArray();
      for (const ch of chars) ceoNameById.set(ch._id.toString(), ch.name);
    }

    return NextResponse.json({
      corporations: corps.map((c) => ({
        id: c._id.toString(),
        name: c.name,
        ceoName: c.ceoId ? ceoNameById.get(c.ceoId.toString()) : undefined,
      })),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

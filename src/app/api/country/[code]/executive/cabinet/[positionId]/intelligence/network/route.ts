// POST /api/country/[code]/executive/cabinet/[positionId]/intelligence/network
//
// Set the funding level on a network in one target country, creating the network
// on first funding. Money is not drawn here; the turn phase advances progress and
// the operation routes draw the per-operation cost.
//
// Auth: the intelligence seat holder or an admin. Errors: 400, 401, 403, 404
import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getIntelligenceNetworksCollection } from "@/lib/db/collections/intelligence";
import {
  getOrCreateAgency,
  loadCurrentTurn,
  requireIntelligenceHolder,
  type IntelligenceRouteParams,
} from "../shared";

const bodySchema = z.object({
  targetCountryId: z.string().min(2).max(4),
  funding: z.enum(["none", "trickle", "steady", "crash"]),
});

export async function POST(request: Request, { params }: IntelligenceRouteParams) {
  try {
    const { code, positionId } = await params;
    const guard = await requireIntelligenceHolder(code, positionId);
    if ("error" in guard) return guard.error;
    const { db, countryId, member } = guard;

    const parsed = await parseJsonBody(request, bodySchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const targetCountryId = parsed.data.targetCountryId.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[targetCountryId]) {
      return NextResponse.json({ error: "Invalid target country" }, { status: 400 });
    }
    if (targetCountryId === countryId) {
      return NextResponse.json(
        { error: "A service cannot run a network against its own country." },
        { status: 400 }
      );
    }

    const turn = await loadCurrentTurn(db);
    const agency = await getOrCreateAgency(db, countryId, turn, member?.characterId ?? null);

    // A vacant seat may wind a network DOWN but not stand a new effort up.
    // Vacancy degrades a service; it does not freeze it.
    if (agency.directorCharacterId == null && parsed.data.funding !== "none") {
      return NextResponse.json(
        { error: "The service has no director. Appoint one before funding new work." },
        { status: 403 }
      );
    }

    const networks = await getIntelligenceNetworksCollection(db);
    await networks.updateOne(
      { ownerCountryId: countryId, targetCountryId },
      {
        $set: { funding: parsed.data.funding, updatedAt: new Date() },
        $setOnInsert: {
          ownerCountryId: countryId,
          targetCountryId,
          level: 0,
          progress: 0,
          suspicion: 0,
          status: "building",
          cooledUntilTurn: null,
          lastOpTurn: 0,
        },
      },
      { upsert: true }
    );

    const network = await networks.findOne({ ownerCountryId: countryId, targetCountryId });
    return NextResponse.json({
      targetCountryId,
      funding: parsed.data.funding,
      level: network?.level ?? 0,
      status: network?.status ?? "building",
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

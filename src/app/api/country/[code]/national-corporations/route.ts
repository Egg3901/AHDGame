// GET /api/country/[code]/national-corporations
// Roster of a country's National Corporations (primary + split-offs) for the
// State Enterprises panel on the finance-minister office page. Spec §24.
// Auth: public read (mutating reorg/CEO routes enforce authority)
// Errors: 400
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { CORPORATION_TYPES, type CorporationType } from "@/lib/constants/corporations";
import type { Character, Corporation, CorporateSector } from "@/lib/db/types";

interface RouteParams {
  params: Promise<{ code: string }>;
}

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { code } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }

    const db = await getDb();
    const corps = await db
      .collection<Corporation>("corporations")
      .find({ countryOwnerId: countryId })
      .toArray();

    const corpIds = corps.map((c) => c._id);
    const sectors =
      corpIds.length > 0
        ? await db
            .collection<CorporateSector>("corporateSectors")
            .find({ corporationId: { $in: corpIds } })
            .project<{
              corporationId: CorporateSector["corporationId"];
              sectorType: CorporateSector["sectorType"];
              revenue: CorporateSector["revenue"];
              workers: CorporateSector["workers"];
            }>({ corporationId: 1, sectorType: 1, revenue: 1, workers: 1 })
            .toArray()
        : [];
    // Per-corp performance roll-up (cheap — from the sectors already loaded).
    const sectorCount = new Map<string, number>();
    const revenuePerTurn = new Map<string, number>();
    const workers = new Map<string, number>();
    for (const s of sectors) {
      const key = String(s.corporationId);
      sectorCount.set(key, (sectorCount.get(key) ?? 0) + 1);
      revenuePerTurn.set(key, (revenuePerTurn.get(key) ?? 0) + Math.round(s.revenue ?? 0));
      workers.set(key, (workers.get(key) ?? 0) + Math.round(s.workers ?? 0));
    }

    const ceoIds = corps.filter((c) => !c.ceoVacant && c.ceoId).map((c) => c.ceoId);
    const ceos =
      ceoIds.length > 0
        ? await db
            .collection<Character>("characters")
            .find({ _id: { $in: ceoIds } })
            .project<{ _id: Character["_id"]; name: string }>({ _id: 1, name: 1 })
            .toArray()
        : [];
    const ceoNameById = new Map(ceos.map((c) => [String(c._id), c.name]));

    // Sector types the minister can split off = those the PRIMARY National
    // Corporation actually holds (fully or partially nationalized). A split moves
    // the primary's sectors of that type into a new corp, so types already split
    // off — or never nationalized — are naturally excluded (the primary holds
    // none of them). Ordered by CORPORATION_TYPES for a stable dropdown.
    const primaryId = corps.find((c) => c.isPrimaryNationalCorporation)?._id;
    const primaryHeldTypes = new Set<string>();
    if (primaryId) {
      for (const s of sectors) {
        if (String(s.corporationId) === String(primaryId)) primaryHeldTypes.add(s.sectorType);
      }
    }
    const splittableSectorTypes = CORPORATION_TYPES.filter((t) =>
      primaryHeldTypes.has(t)
    ) as CorporationType[];

    const corporations = corps
      .map((c) => ({
        id: String(c._id),
        name: c.name,
        isPrimary: !!c.isPrimaryNationalCorporation,
        assignedSectorTypes: (c.assignedSectorTypes ?? []) as CorporationType[],
        sectorCount: sectorCount.get(String(c._id)) ?? 0,
        revenuePerTurn: revenuePerTurn.get(String(c._id)) ?? 0,
        workers: workers.get(String(c._id)) ?? 0,
        liquidCapital: Math.round(c.liquidCapital ?? 0),
        currency: c.liquidCurrencyCode ?? "USD",
        ceoVacant: !!c.ceoVacant,
        ceoName: c.ceoVacant ? null : (ceoNameById.get(String(c.ceoId)) ?? null),
      }))
      .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.name.localeCompare(b.name));

    return NextResponse.json({ corporations, splittableSectorTypes });
  } catch (error) {
    return handleRouteError(error);
  }
}

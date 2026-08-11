// GET /api/country/[code]/pending-nationalizations
// Pending (notice-window) nationalizations for the country (spec §14): the
// public takings dashboard with countdown + cited/curable conditions. Read-only;
// resolution happens in the corp turn (processPendingNationalizations).
// Auth: public read
// Errors: 400
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import type {
  Corporation,
  CorporateSector,
  FederalBudget,
  PendingNationalization,
} from "@/lib/db/types";
import type { NationalizationTrigger } from "@/lib/nationalization/eligibility";
import { getCurrentTurn } from "@/lib/turn/currentTurn";

const CURABLE: ReadonlySet<NationalizationTrigger> = new Set(["strategic", "monopoly"]);

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
    const currentTurn = await getCurrentTurn(db);

    // Signed national treasury balance (local currency) — the unified pool that
    // takings, draws, and privatization proceeds move. Negative ⇒ national debt.
    const fb = await db
      .collection<FederalBudget>("federalBudget")
      .findOne({ countryId }, { projection: { treasuryBalance: 1, "debt.principal": 1 } });
    const treasuryReserve = fb?.treasuryBalance ?? -(fb?.debt?.principal ?? 0);
    const currencyCode = COUNTRY_CURRENCY_MAP[countryId] ?? "USD";

    const rows = await db
      .collection<PendingNationalization>("pendingNationalizations")
      .find({ countryId, status: "pending" })
      .toArray();

    // Resolve display names: gather corp ids (direct + via sector).
    const sectorIds = rows.map((r) => r.targetSectorId).filter(Boolean) as ObjectId[];
    const sectorById = new Map<string, CorporateSector>();
    if (sectorIds.length > 0) {
      const sectors = await db
        .collection<CorporateSector>("corporateSectors")
        .find({ _id: { $in: sectorIds } })
        .toArray();
      for (const s of sectors) sectorById.set(String(s._id), s);
    }

    const corpIds = new Set<string>();
    for (const r of rows) {
      if (r.targetCorporationId) corpIds.add(String(r.targetCorporationId));
      if (r.targetSectorId) {
        const s = sectorById.get(String(r.targetSectorId));
        if (s) corpIds.add(String(s.corporationId));
      }
    }
    const corpNames = new Map<string, string>();
    if (corpIds.size > 0) {
      const corps = await db
        .collection<Corporation>("corporations")
        .find({ _id: { $in: Array.from(corpIds).map((id) => new ObjectId(id)) } })
        .project<{ _id: Corporation["_id"]; name: string }>({ _id: 1, name: 1 })
        .toArray();
      for (const c of corps) corpNames.set(String(c._id), c.name);
    }

    const pending = rows
      .map((r) => {
        let targetName = "Unknown asset";
        let isSector = false;
        if (r.targetCorporationId) {
          targetName = corpNames.get(String(r.targetCorporationId)) ?? "Corporation";
        } else if (r.targetSectorId) {
          isSector = true;
          const s = sectorById.get(String(r.targetSectorId));
          const owner = s ? corpNames.get(String(s.corporationId)) : null;
          targetName = s ? `${owner ?? "Corporation"} · ${s.sectorType}` : "Sector";
        }
        return {
          id: String(r._id),
          targetName,
          isSector,
          tier: r.tier,
          method: r.method,
          triggers: r.triggers,
          // Legislative takings complete regardless of the cited cause (a passed
          // bill is not curable), so they expose no curable triggers to the UI.
          curableTriggers:
            r.method === "legislative" ? [] : r.triggers.filter((t) => CURABLE.has(t)),
          noticeDeadlineTurn: r.noticeDeadlineTurn,
          postedAtTurn: r.postedAtTurn,
        };
      })
      .sort((a, b) => a.noticeDeadlineTurn - b.noticeDeadlineTurn);

    return NextResponse.json({ currentTurn, treasuryReserve, currencyCode, pending });
  } catch (error) {
    return handleRouteError(error);
  }
}

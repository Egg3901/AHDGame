// GET diagnoses / POST fixes NaN values on UK statePartyOrg.organization and
// NaN stats on active NPPs.
// Auth: requireAdmin
// Errors: 401, 500
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import type { StatePartyOrg, NPP } from "@/lib/db/types";

interface DiagnosticResult {
  ukSpoWithNaNOrg: number;
  nppsWithNaNFunds: number;
  nppsWithNaNActionPoints: number;
  nppsWithNaNPoliticalInfluence: number;
  nppsWithNaNFavorability: number;
  nppsWithNaNDonorBaseLevel: number;
}

/**
 * GET /api/admin/heal/npp-data-corruption
 * Diagnose NaN values on UK StatePartyOrg.organization and NaN NPP stats.
 */
export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();

    const allUkSpos = await db
      .collection<StatePartyOrg>("statePartyOrg")
      .find({ countryId: "UK" })
      .toArray();

    let ukSpoWithNaNOrg = 0;
    for (const spo of allUkSpos) {
      if (!Number.isFinite(spo.organization)) ukSpoWithNaNOrg++;
    }

    const allNpps = await db
      .collection<NPP>("npps")
      .find({ retiredAt: null })
      .project<{
        funds?: number;
        actionPoints?: number;
        politicalInfluence: number;
        favorability: number;
        donorBaseLevel?: number;
      }>({
        funds: 1,
        actionPoints: 1,
        politicalInfluence: 1,
        favorability: 1,
        donorBaseLevel: 1,
      })
      .toArray();

    let nppsWithNaNFunds = 0;
    let nppsWithNaNActionPoints = 0;
    let nppsWithNaNPoliticalInfluence = 0;
    let nppsWithNaNFavorability = 0;
    let nppsWithNaNDonorBaseLevel = 0;

    for (const npp of allNpps) {
      if (npp.funds !== undefined && !Number.isFinite(npp.funds)) nppsWithNaNFunds++;
      if (npp.actionPoints !== undefined && !Number.isFinite(npp.actionPoints))
        nppsWithNaNActionPoints++;
      if (!Number.isFinite(npp.politicalInfluence)) nppsWithNaNPoliticalInfluence++;
      if (!Number.isFinite(npp.favorability)) nppsWithNaNFavorability++;
      if (npp.donorBaseLevel !== undefined && !Number.isFinite(npp.donorBaseLevel))
        nppsWithNaNDonorBaseLevel++;
    }

    const result: DiagnosticResult = {
      ukSpoWithNaNOrg,
      nppsWithNaNFunds,
      nppsWithNaNActionPoints,
      nppsWithNaNPoliticalInfluence,
      nppsWithNaNFavorability,
      nppsWithNaNDonorBaseLevel,
    };

    const totalIssues = Object.values(result).reduce((a, b) => a + b, 0);

    return NextResponse.json({
      status: totalIssues === 0 ? "ok" : "issues_found",
      totalIssues,
      ...result,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * POST /api/admin/heal/npp-data-corruption
 * Fix NaN values on UK StatePartyOrg.organization and on NPP stats.
 */
export async function POST() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const spoCol = db.collection<StatePartyOrg>("statePartyOrg");
    const nppCol = db.collection<NPP>("npps");

    const fixes: string[] = [];

    // ── Fix UK SPOs with NaN organization ─────────────────────────────────
    const ukSpos = await spoCol.find({ countryId: "UK" }).toArray();
    let nanOrgFixed = 0;
    for (const spo of ukSpos) {
      if (!Number.isFinite(spo.organization)) {
        await spoCol.updateOne({ _id: spo._id }, { $set: { organization: 0 } });
        nanOrgFixed++;
      }
    }
    if (nanOrgFixed > 0) {
      fixes.push(`Reset ${nanOrgFixed} UK SPOs with NaN organization to 0`);
    }

    // ── Fix NPPs with NaN stats ───────────────────────────────────────────
    const allNpps = await nppCol.find({ retiredAt: null }).toArray();
    let nppFixed = 0;

    for (const npp of allNpps) {
      const setOps: Record<string, number> = {};

      if (npp.funds !== undefined && !Number.isFinite(npp.funds)) setOps.funds = 0;
      if (npp.actionPoints !== undefined && !Number.isFinite(npp.actionPoints))
        setOps.actionPoints = 0;
      if (!Number.isFinite(npp.politicalInfluence)) setOps.politicalInfluence = 0;
      if (!Number.isFinite(npp.favorability)) setOps.favorability = 0;
      if (npp.donorBaseLevel !== undefined && !Number.isFinite(npp.donorBaseLevel))
        setOps.donorBaseLevel = 0;

      if (Object.keys(setOps).length > 0) {
        await nppCol.updateOne({ _id: npp._id }, { $set: setOps });
        nppFixed++;
      }
    }

    if (nppFixed > 0) {
      fixes.push(`Reset NaN stats on ${nppFixed} NPPs to 0`);
    }

    return NextResponse.json({
      success: true,
      message: fixes.length > 0 ? fixes.join(". ") + "." : "No issues found.",
      nanOrgFixed,
      nppFixed,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

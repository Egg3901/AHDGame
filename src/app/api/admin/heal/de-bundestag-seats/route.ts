/**
 * GET /api/admin/heal/de-bundestag-seats
 *
 * Diagnoses DE Bundestag electedOfficials by comparing per-Land seat counts
 * against expected totals (Wahlkreise + list seats from historical seed).
 *
 * POST is not supported — DE AMS seat allocation is too complex to safely
 * rebuild from election tallies without running the full germanyAMS resolver.
 * Use the admin election spawn/re-resolve tools instead.
 */

import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { DE_WAHLKREIS_SEATS } from "@/lib/constants/states";
import type { ElectedOfficial } from "@/lib/db/types";

interface LandDiagnostic {
  land: string;
  status: "ok" | "mismatch" | "missing";
  expectedSeats: number;
  actualSeats: number;
  officialCount: number;
  parties: Record<string, number>;
}

export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();

    // Get all DE bundestag officials
    const officials = await db
      .collection<ElectedOfficial>("electedOfficials")
      .find({ officeType: "bundestag", countryId: "DE" })
      .toArray();

    // Group by Land
    const byLand = new Map<string, ElectedOfficial[]>();
    for (const o of officials) {
      const land = o.state ?? "unknown";
      const list = byLand.get(land) ?? [];
      list.push(o);
      byLand.set(land, list);
    }

    const diagnostics: LandDiagnostic[] = [];
    let issuesFound = 0;

    for (const [land, expectedSeats] of Object.entries(DE_WAHLKREIS_SEATS)) {
      const landOfficials = byLand.get(land) ?? [];
      const actualSeats = landOfficials.reduce((sum, o) => sum + (o.seatsHeld ?? 0), 0);
      const parties: Record<string, number> = {};
      for (const o of landOfficials) {
        const p = o.party ?? "unknown";
        parties[p] = (parties[p] ?? 0) + (o.seatsHeld ?? 0);
      }

      let status: "ok" | "mismatch" | "missing" = "ok";
      if (landOfficials.length === 0) {
        status = "missing";
        issuesFound++;
      } else if (actualSeats !== expectedSeats) {
        status = "mismatch";
        issuesFound++;
      }

      diagnostics.push({
        land,
        status,
        expectedSeats,
        actualSeats,
        officialCount: landOfficials.length,
        parties,
      });
    }

    // ── Federal-level checks (per-Land Wahlkreis totals alone miss these) ──
    // The chamber is 630 nominal + AMS overhang. A large overshoot means stale/
    // duplicate officials (e.g. issue #2957: a non-atomic reconciliation double-run
    // doubled every list bloc → 963/630). Also flag duplicate list-bloc keys
    // directly: assignListSeats emits exactly one (party, Land) doc per bloc, so any
    // (party, Land) with >1 seatSource:"list" doc is a duplication artifact.
    const NOMINAL_SEATS = 630;
    const OVERHANG_TOLERANCE = Math.round(NOMINAL_SEATS * 0.2); // ~756 hard ceiling
    const totalSeats = officials.reduce((sum, o) => sum + (o.seatsHeld ?? 0), 0);

    const listKeyCounts = new Map<string, number>();
    for (const o of officials) {
      if (o.seatSource !== "list") continue;
      const key = `${o.party ?? "?"}|${o.state ?? "?"}`;
      listKeyCounts.set(key, (listKeyCounts.get(key) ?? 0) + 1);
    }
    const duplicateListKeys = [...listKeyCounts.entries()]
      .filter(([, n]) => n > 1)
      .map(([key, n]) => ({ key, docs: n }));

    const federalIssues: string[] = [];
    if (totalSeats > NOMINAL_SEATS + OVERHANG_TOLERANCE) {
      federalIssues.push(
        `Chamber total ${totalSeats} exceeds ${NOMINAL_SEATS}+overhang ceiling (${NOMINAL_SEATS + OVERHANG_TOLERANCE}).`
      );
    }
    if (duplicateListKeys.length > 0) {
      federalIssues.push(
        `${duplicateListKeys.length} (party, Land) list bloc(s) have duplicate officials.`
      );
    }
    issuesFound += federalIssues.length;

    return NextResponse.json({
      status: issuesFound === 0 ? "ok" : "issues_found",
      message:
        issuesFound === 0
          ? `All 16 Länder have correct Bundestag seat allocations (chamber total ${totalSeats}).`
          : `Found ${issuesFound} issue(s) in Bundestag seat allocations.`,
      totalLands: diagnostics.length,
      issuesFound,
      federal: {
        totalSeats,
        nominalSeats: NOMINAL_SEATS,
        overhangCeiling: NOMINAL_SEATS + OVERHANG_TOLERANCE,
        duplicateListKeys,
        issues: federalIssues,
      },
      lands: diagnostics.filter((d) => d.status !== "ok"),
      diagnostics,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST() {
  return NextResponse.json(
    {
      error:
        "POST not supported for DE Bundestag. Seat allocation requires the full AMS resolver. " +
        "Use admin election tools or re-seed instead.",
    },
    { status: 405 }
  );
}

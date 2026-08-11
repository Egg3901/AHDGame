/**
 * GET /api/admin/country/[code]/one-party-readiness
 *
 * Admin-only diagnostic. Returns a readiness report for a one-party
 * state without making any database writes. Checks seeds, collections,
 * and core loop prerequisites.
 *
 * Country must have `governmentType: "onePartyState"`.
 */

import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";

interface ReadinessCheck {
  name: string;
  status: "ok" | "missing" | "warning";
  count?: number;
  detail?: string;
}

export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    const countryId = code.toUpperCase() as CountryId;
    const config = COUNTRY_CONFIGS[countryId];
    if (!config) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 404 });
    }
    if (config.governmentType !== "onePartyState") {
      return NextResponse.json({ error: "Country is not a one-party state" }, { status: 400 });
    }

    const adminCheck = await requireAdmin();
    if (!adminCheck.ok) return adminCheck.response;

    const db = await getDb();
    const checks: ReadinessCheck[] = [];

    // 1. Regions seeded (sub-national chamber gives us the expected count)
    const regions = await db
      .collection<{ _id: string }>("states")
      .find({ countryId }, { projection: { _id: 1 } })
      .toArray();
    const regionCount = regions.length;
    checks.push({
      name: "Regions",
      status: regionCount > 0 ? "ok" : "missing",
      count: regionCount,
      detail: `${regionCount} regions seeded for ${countryId}`,
    });

    // 2. Parties seeded (expect at least the majorPartyIds count)
    const expectedPartyCount = Math.max(config.majorPartyIds.length, 1);
    const partyCount = await db.collection("politicalParties").countDocuments({ countryId });
    checks.push({
      name: "Parties",
      status: partyCount >= expectedPartyCount ? "ok" : partyCount > 0 ? "warning" : "missing",
      count: partyCount,
      detail: `Expected ≥${expectedPartyCount}, found ${partyCount}`,
    });

    // 3. Party org rows (parties × regions)
    const orgCount = await db.collection("statePartyOrg").countDocuments({ countryId });
    const expectedOrgCount = partyCount * regionCount;
    checks.push({
      name: "StatePartyOrg",
      status: orgCount === expectedOrgCount ? "ok" : orgCount > 0 ? "warning" : "missing",
      count: orgCount,
      detail: `Expected ${expectedOrgCount} (${partyCount} parties × ${regionCount} regions), found ${orgCount}`,
    });

    // 4. Government formation doc
    const gov = await db
      .collection<{ _id: string; status?: string; cycle?: number }>("governmentFormations")
      .findOne({ _id: countryId });
    checks.push({
      name: "GovernmentFormation",
      status: gov ? "ok" : "missing",
      detail: gov
        ? `Status: ${gov.status}, cycle: ${gov.cycle}`
        : `No ${countryId} governmentFormations doc`,
    });

    // 5. Seats (lower chamber + governor per region)
    const seatCount = await db.collection("seats").countDocuments({ countryId });
    const expectedSeatCount = regionCount * 2; // delegate + governor per region
    checks.push({
      name: "Seats",
      status: seatCount >= expectedSeatCount ? "ok" : seatCount > 0 ? "warning" : "missing",
      count: seatCount,
      detail: `Expected ≥${expectedSeatCount} (${regionCount} delegates + ${regionCount} governors), found ${seatCount}`,
    });

    // 6. NPPs (≥3 per region by Phase 07 convention)
    const nppCount = await db.collection("npps").countDocuments({ countryId });
    const expectedNppCount = regionCount * 3;
    checks.push({
      name: "NPPs",
      status: nppCount >= expectedNppCount ? "ok" : nppCount > 0 ? "warning" : "missing",
      count: nppCount,
      detail: `Expected ≥${expectedNppCount} (3 per region), found ${nppCount}`,
    });

    // 7. Elected officials
    const officialCount = await db.collection("electedOfficials").countDocuments({ countryId });
    checks.push({
      name: "ElectedOfficials",
      status: officialCount >= expectedNppCount ? "ok" : officialCount > 0 ? "warning" : "missing",
      count: officialCount,
      detail: `Expected ≥${expectedNppCount}, found ${officialCount}`,
    });

    // 8. Demographics (one per region)
    const demoCount = await db.collection("stateDemographics").countDocuments({ countryId });
    checks.push({
      name: "Demographics",
      status: demoCount === regionCount ? "ok" : demoCount > 0 ? "warning" : "missing",
      count: demoCount,
      detail: `Expected ${regionCount}, found ${demoCount}`,
    });

    // 9. State metrics (one per region — by region _id, country-agnostic)
    const regionIds = regions.map((r) => r._id);
    // macroMetrics, not stateMetrics — see countryReadinessReport: counting the
    // retired collection reported every country as missing its region metrics.
    const metricsCount = await db
      .collection<{ _id: string }>("macroMetrics")
      .countDocuments({ _id: { $in: regionIds } });
    checks.push({
      name: "RegionMetrics",
      status: metricsCount === regionCount ? "ok" : metricsCount > 0 ? "warning" : "missing",
      count: metricsCount,
      detail: `Expected ${regionCount}, found ${metricsCount}`,
    });

    // 10. Legislation types
    const legTypeCount = await db.collection("legislationTypes").countDocuments({ countryId });
    checks.push({
      name: "LegislationTypes",
      status: legTypeCount > 0 ? "ok" : "missing",
      count: legTypeCount,
      detail: `Found ${legTypeCount} ${countryId} legislation types`,
    });

    // 11. Country leader state (if any leader installed)
    const leaderStateCount = await db
      .collection<{ _id: string }>("countryLeaderStates")
      .countDocuments({ _id: { $regex: `^${countryId}_` } });
    checks.push({
      name: "CountryLeaderStates",
      status: leaderStateCount > 0 ? "ok" : "warning",
      count: leaderStateCount,
      detail:
        leaderStateCount > 0
          ? `${leaderStateCount} leader confidence state(s)`
          : "No leader installed yet (expected until first PM appointment)",
    });

    // Summary
    const missing = checks.filter((c) => c.status === "missing").length;
    const warnings = checks.filter((c) => c.status === "warning").length;
    const ok = checks.filter((c) => c.status === "ok").length;
    const ready = missing === 0 && warnings === 0;

    return NextResponse.json({
      ready,
      summary: { ok, warning: warnings, missing },
      checks,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

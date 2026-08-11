import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { getIndexFundsMode } from "@/lib/indexFunds/featureFlag";
import { getAllFundDefinitions } from "@/lib/indexFunds/fundDefinitions";
import { filterFundsForExchange } from "@/lib/indexFunds/fundExchangeFilter";
import { listFunds } from "@/lib/indexFunds/fundQueries";

// GET /api/admin/investment-funds/diagnostics — Why specific funds are hidden from players.
// Auth: requireAdmin
// Errors: 401, 403
export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const mode = await getIndexFundsMode();

    const migrationMarker = await db
      .collection<{ _id: string }>("migrationsRun")
      .findOne({ _id: "2026-06-01-index-fund-seed" }, { projection: { _id: 1 } });

    const expectedDefinitions = getAllFundDefinitions();
    const actualFunds = await listFunds(db);
    const actualBySlug = new Map(actualFunds.map((f) => [f.slug, f]));

    const expectedFunds = expectedDefinitions.map((def) => {
      const actual = actualBySlug.get(def.slug);
      const issues: string[] = [];

      if (!actual) {
        issues.push("Not seeded — missing from indexFunds collection");
      } else {
        if (actual.status !== "active") {
          issues.push(
            `Status is "${actual.status}"${actual.pauseReason ? ` (${actual.pauseReason})` : ""}`
          );
        }
        if (actual.scope !== def.scope) {
          issues.push(`DB scope mismatch: expected "${def.scope}", found "${actual.scope}"`);
        }
        if (def.countryId && actual.countryId !== def.countryId) {
          issues.push(
            `DB countryId mismatch: expected "${def.countryId}", found "${actual.countryId ?? "undefined"}"`
          );
        }
      }

      const visibleOnGlobal = actual
        ? filterFundsForExchange([actual], "global").length > 0
        : false;
      const visibleOnOwnCountry =
        actual && def.countryId
          ? filterFundsForExchange([actual], def.countryId).length > 0
          : false;

      return {
        slug: def.slug,
        name: def.name,
        ticker: def.ticker,
        expected: {
          scope: def.scope,
          kind: def.kind,
          countryId: def.countryId ?? null,
          sectorType: def.sectorType ?? null,
          anchorCurrencyCode: def.anchorCurrencyCode,
        },
        actual: actual
          ? {
              id: actual._id.toString(),
              status: actual.status,
              scope: actual.scope,
              kind: actual.kind,
              countryId: actual.countryId ?? null,
              sectorType: actual.sectorType ?? null,
              anchorCurrencyCode: actual.anchorCurrencyCode,
              pauseReason: actual.pauseReason ?? null,
              pausedAt: actual.pausedAt ? actual.pausedAt.toISOString() : null,
              quotedNav: actual.quotedNav,
              unitSupply: actual.unitSupply,
              targetConstituentsCount: actual.targetConstituents.length,
              holdingsCount: actual.holdings.length,
            }
          : null,
        visibleOnGlobal,
        visibleOnOwnCountry,
        issues,
      };
    });

    const summary = {
      totalExpected: expectedDefinitions.length,
      totalInDb: actualFunds.length,
      missing: expectedFunds.filter((f) => f.actual === null).length,
      paused: expectedFunds.filter((f) => f.actual?.status === "paused").length,
      delisted: expectedFunds.filter((f) => f.actual?.status === "delisted").length,
      active: expectedFunds.filter((f) => f.actual?.status === "active").length,
    };

    const broadFundsMissing = expectedFunds.some(
      (f) => f.expected.kind === "broad" && f.expected.scope === "global" && f.issues.length > 0
    );

    return NextResponse.json({
      success: true,
      featureFlag: {
        mode,
        enabled: mode === "partial" || mode === "full",
      },
      migration: {
        id: "2026-06-01-index-fund-seed",
        markerPresent: migrationMarker !== null,
      },
      summary,
      expectedFunds,
      note: broadFundsMissing
        ? "Broad market funds are missing or hidden. If the migration marker is present but funds are missing, clear index funds (Admin → Index Funds → Clear) and re-enable to re-seed."
        : undefined,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

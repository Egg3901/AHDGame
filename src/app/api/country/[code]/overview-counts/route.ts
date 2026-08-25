import { NextResponse } from "next/server";
import type { Db } from "mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { buildNationalBillCountryScopeFilter } from "@/lib/legislature/nationalBillScope";
import { getBankId } from "@/lib/centralBank/helpers";
import type { CentralBank, FederalBudget, GameConfig, GameState, State } from "@/lib/db/types";
import { federalSurplus } from "@/lib/budget/federalSurplus";
import { resolveRatioGdp } from "@/lib/budget/gdpDenominator";
import { isColdWarPrincipal, type OverviewCounts } from "@/lib/country/overviewCounts";
import { getColdWarDials } from "@/lib/coldwar/dials";
import { commandEconomyOffices } from "@/lib/constants/commandEconomyOffices";
import { DUAL_TRACK_CEILING, scheduledMarketizationLevel } from "@/lib/constants/commandEconomy";
import { getNationalBudgetId } from "@/lib/bonds/sovereign";

export type { OverviewCounts } from "@/lib/country/overviewCounts";

/**
 * Bill statuses that are final — anything else is still before the
 * legislature (proposed/active/passed_origin/active_other/enrolled/
 * cabinet_review/override flows all count as in-flight).
 */
const FINAL_BILL_STATUSES = [
  "signed",
  "enacted",
  "failed",
  "override_failed",
  "withdrawn",
  "vetoed",
];

/** Each figure degrades to null independently — a failed count never 500s the route. */
async function orNull<T>(promise: Promise<T>): Promise<T | null> {
  try {
    return await promise;
  } catch {
    return null;
  }
}

async function countPoliticians(db: Db, countryId: CountryId): Promise<number> {
  // Mirrors fetchPoliticians: players excluding banned users, plus active NPPs —
  // keeps the directory figure equal to the Politicians page count.
  const [playerRows, nppCount] = await Promise.all([
    db
      .collection("characters")
      .aggregate<{ count: number }>([
        { $match: { countryId } },
        {
          $lookup: {
            from: "users",
            // Typed equality join (userId and users._id are both ObjectIds) so
            // the _id index is used. The previous $expr compared $toString(_id)
            // to the raw ObjectId, which never matched and skipped the index.
            localField: "userId",
            foreignField: "_id",
            pipeline: [{ $project: { isBanned: 1 } }],
            as: "_user",
          },
        },
        { $addFields: { _userDoc: { $arrayElemAt: ["$_user", 0] } } },
        { $match: { $or: [{ "_userDoc.isBanned": { $ne: true } }, { _userDoc: null }] } },
        { $count: "count" },
      ])
      .toArray(),
    db.collection("npps").countDocuments({ retiredAt: null, countryId }),
  ]);
  return (playerRows[0]?.count ?? 0) + nppCount;
}

/**
 * True when the country runs a flag-on planned economy right now, so the
 * Explore directory should surface the Command Economy dashboard link. Only
 * multi-SOE command countries do any work here; everyone else short-circuits.
 */
async function resolveCommandEconomyActive(db: Db, countryId: CountryId): Promise<boolean> {
  if (!commandEconomyOffices(countryId)) return false;
  const [config, state, budget] = await Promise.all([
    db
      .collection<GameConfig>("gameConfig")
      .findOne({ _id: "default" }, { projection: { commandEconomyEnabled: 1 } }),
    db
      .collection<GameState>("gameState")
      .findOne({ _id: "current" }, { projection: { currentYear: 1 } }),
    db
      .collection<FederalBudget>("federalBudget")
      .findOne({ _id: getNationalBudgetId(countryId) } as { _id: "federal" }, {
        projection: { "economicFactors.marketizationLevel": 1 },
      }),
  ]);
  const enabled = config?.commandEconomyEnabled === true;
  if (!enabled) return false;
  const currentYear = state?.currentYear ?? null;
  // Prefer the persisted (endogenous) level over the era schedule — the
  // stored-level registry is process-local, so this API process must read the
  // persisted value. A country that has fully marketized past the dual-track
  // ceiling (70) no longer shows the planned-economy surface.
  const persisted = budget?.economicFactors?.marketizationLevel;
  const level =
    typeof persisted === "number" && Number.isFinite(persisted)
      ? persisted
      : scheduledMarketizationLevel(countryId, currentYear);
  return level < DUAL_TRACK_CEILING;
}

/**
 * National GDP (millions) and the budget balance as a share of GDP, on the same
 * bases the Budget and Economy pages use so the country directory cannot report
 * a third set of figures:
 *
 *   - the GDP LEVEL is the live sum of regional `state.gdp` (the A1 SSOT), not
 *     `budget.gdp`, which is only refreshed at fiscal close;
 *   - the balance is DERIVED from revenue and spending, not read from the
 *     `surplus` cache, which drifts intra-year;
 *   - the RATIO divides by `gdpSmoothed`, matching the stored `debtToGdpRatio`.
 *
 * Both stay null when the budget document is missing rather than falling to
 * zero, so the directory shows a chevron instead of asserting a balanced budget
 * for a country whose budget has not been created yet.
 */
async function resolveFiscalFigures(
  db: Db,
  countryId: CountryId
): Promise<{ gdpMillions: number | null; budgetBalancePctGdp: number | null }> {
  const [budget, gdpAgg] = await Promise.all([
    db
      .collection<FederalBudget>("federalBudget")
      .findOne({ _id: getNationalBudgetId(countryId) } as { _id: "federal" }, {
        projection: { gdp: 1, gdpSmoothed: 1, "revenue.total": 1, "spending.total": 1 },
      }),
    db
      .collection<State>("states")
      .aggregate<{ _id: null; gdpMillions: number }>([
        { $match: { countryId } },
        { $group: { _id: null, gdpMillions: { $sum: "$gdp" } } },
      ])
      .toArray(),
  ]);

  if (!budget) return { gdpMillions: null, budgetBalancePctGdp: null };

  const summedMillions = gdpAgg[0]?.gdpMillions;
  const liveMillions =
    typeof summedMillions === "number" && Number.isFinite(summedMillions) && summedMillions > 0
      ? summedMillions
      : null;
  // Fall back to the budget snapshot only when the country has no regional GDP
  // to sum (pre-reconciliation worlds), mirroring fiscalYear.ts.
  const gdpMillions =
    liveMillions ??
    (typeof budget.gdp === "number" && Number.isFinite(budget.gdp) && budget.gdp > 0
      ? budget.gdp / 1_000_000
      : null);

  const ratioGdp = resolveRatioGdp(budget);
  const balance = federalSurplus(budget);

  return {
    gdpMillions,
    budgetBalancePctGdp: ratioGdp > 0 ? (balance / ratioGdp) * 100 : null,
  };
}

/**
 * Cold War readiness for a principal, or null. Gated on the same
 * `conflictsEnabled` switch as `/world/conflicts` itself, so switching the
 * subsystem off removes the directory row rather than leaving a link to a page
 * that redirects.
 */
async function resolveColdWarDefcon(db: Db, countryId: CountryId): Promise<number | null> {
  if (!isColdWarPrincipal(countryId)) return null;
  const gameState = await db
    .collection<GameState>("gameState")
    .findOne({ _id: "current" }, { projection: { conflictsEnabled: 1 } });
  if (!gameState?.conflictsEnabled) return null;
  return (await getColdWarDials(db)).defcon;
}

async function assembleOverviewCounts(db: Db, countryId: CountryId): Promise<OverviewCounts> {
  const [
    parties,
    politicians,
    activeElections,
    upcomingElections,
    bills,
    regions,
    primeRate,
    commandEconomy,
    unions,
    activeReferendums,
    totalReferendums,
    fiscal,
    coldWarDefcon,
  ] = await Promise.all([
    orNull(
      db.collection("politicalParties").countDocuments({ countryId, isDefunct: { $ne: true } })
    ),
    orNull(countPoliticians(db, countryId)),
    orNull(db.collection("elections").countDocuments({ countryId, status: "active" })),
    orNull(db.collection("elections").countDocuments({ countryId, status: "upcoming" })),
    orNull(
      db.collection("bills").countDocuments({
        ...buildNationalBillCountryScopeFilter(countryId),
        status: { $nin: FINAL_BILL_STATUSES },
      })
    ),
    orNull(db.collection("states").countDocuments({ countryId })),
    orNull(
      db
        .collection<CentralBank>("centralBanks")
        .findOne({ _id: getBankId(countryId) }, { projection: { primeRate: 1 } })
        .then((bank) => bank?.primeRate ?? null)
    ),
    orNull(resolveCommandEconomyActive(db, countryId)).then((v) => v ?? false),
    orNull(db.collection("unions").countDocuments({ countryId })),
    orNull(db.collection("referendums").countDocuments({ countryId, status: "campaigning" })),
    orNull(db.collection("referendums").countDocuments({ countryId })),
    orNull(resolveFiscalFigures(db, countryId)),
    orNull(resolveColdWarDefcon(db, countryId)),
  ]);
  return {
    parties,
    politicians,
    activeElections,
    upcomingElections,
    bills,
    regions,
    primeRate,
    commandEconomy,
    unions,
    activeReferendums,
    totalReferendums,
    gdpMillions: fiscal?.gdpMillions ?? null,
    budgetBalancePctGdp: fiscal?.budgetBalancePctGdp ?? null,
    coldWarDefcon,
  };
}

// GET /api/country/[code]/overview-counts - Batched live figures for the
// country lander's Explore directory. Every field is nullable; the UI
// degrades a row to a plain chevron when its figure is missing.
// Auth: public
// Errors: 400
export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }
    const db = await getDb();
    const counts = await assembleOverviewCounts(db, countryId);
    return NextResponse.json(counts, {
      headers: { "Cache-Control": "no-store, max-age=0, no-transform" },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

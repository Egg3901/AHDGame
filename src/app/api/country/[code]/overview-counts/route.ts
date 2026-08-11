import { NextResponse } from "next/server";
import type { Db } from "mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { buildNationalBillCountryScopeFilter } from "@/lib/legislature/nationalBillScope";
import { getBankId } from "@/lib/centralBank/helpers";
import type { CentralBank, FederalBudget, GameConfig, GameState } from "@/lib/db/types";
import type { OverviewCounts } from "@/lib/country/overviewCounts";
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

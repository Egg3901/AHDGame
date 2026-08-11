import type { Collection } from "mongodb";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { parseBoundedIntParam } from "@/lib/api/validate";
import { getSiteTrafficPageviewsCollection } from "@/lib/db/collections/siteTrafficPageviews";
import type { SiteTrafficPageview } from "@/lib/db/types/siteTrafficPageview";

/** True when the TTL + query indexes are present (i.e. migrate script has been run). */
async function checkIntegrated(coll: Collection<SiteTrafficPageview>): Promise<boolean> {
  try {
    const info = await coll.indexInformation();
    return "stpv_recordedAt_ttl" in info;
  } catch {
    return false;
  }
}

/** Resolution of the time-series buckets returned in `daily`. */
type Resolution = "hour" | "day";

interface RangeSpec {
  start: Date;
  resolution: Resolution;
  /** Number of buckets the UI should render (so empty buckets appear as zeros). */
  bucketCount: number;
  /** Human label for the range ("24 hours", "7 days", …) — echoed back to UI. */
  label: string;
}

function resolveRange(searchParams: URLSearchParams): RangeSpec {
  if (searchParams.get("hours")) {
    const h = parseBoundedIntParam(searchParams, "hours", 24, 1, 72);
    const end = new Date();
    // Align to top of current hour so buckets are stable across repeated fetches.
    end.setUTCMinutes(0, 0, 0);
    const start = new Date(end);
    start.setUTCHours(start.getUTCHours() - (h - 1));
    return { start, resolution: "hour", bucketCount: h, label: `${h} hours` };
  }

  const days = parseBoundedIntParam(searchParams, "days", 30, 1, 90);
  const end = new Date();
  end.setUTCHours(23, 59, 59, 999);
  const start = new Date(end);
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return { start, resolution: "day", bucketCount: days, label: `${days} days` };
}

// GET /api/admin/traffic/summary — Aggregated traffic for charts.
// Accepts either ?days=N (1-90) or ?hours=N (1-72). Hours wins when both set.
// Auth: requireAdmin
// Errors: 403
export async function GET(request: Request) {
  try {
    const gate = await requireAdmin();
    if (!gate.ok) return gate.response;

    const { searchParams } = new URL(request.url);
    const range = resolveRange(searchParams);

    const coll = await getSiteTrafficPageviewsCollection();

    const dateTruncUnit = range.resolution === "hour" ? "hour" : "day";
    const dateFormat = range.resolution === "hour" ? "%Y-%m-%dT%H:00" : "%Y-%m-%d";

    type FacetShape = {
      daily: Array<{
        bucket: string;
        pageviews: number;
        visits: number;
        authenticatedPageviews: number;
      }>;
      topPaths: Array<{ path: string; views: number; visits: number }>;
      totals: Array<{
        pageviews: number;
        visits: number;
        authenticatedPageviews: number;
      }>;
      byCountry: Array<{ country: string; views: number; visits: number }>;
      byDevice: Array<{ deviceType: string; views: number; visits: number }>;
      byWeekday: Array<{ dow: number; views: number }>;
      /** 6h EST time-of-day buckets (0=00:00-05:59 EST, 1=06:00-11:59, 2=12:00-17:59, 3=18:00-23:59). */
      bySlot: Array<{ slot: number; views: number }>;
      slowestPaths: Array<{ path: string; avgMs: number; samples: number }>;
    };

    const [rows, integrated] = await Promise.all([
      coll
        .aggregate<FacetShape>([
          { $match: { recordedAt: { $gte: range.start } } },
          {
            $facet: {
              daily: [
                {
                  $group: {
                    _id: {
                      $dateTrunc: {
                        date: "$recordedAt",
                        unit: dateTruncUnit,
                        timezone: "UTC",
                      },
                    },
                    pageviews: { $sum: 1 },
                    authenticatedPageviews: { $sum: { $cond: ["$authenticated", 1, 0] } },
                    visitorSet: { $addToSet: "$visitorId" },
                  },
                },
                { $sort: { _id: 1 } },
                {
                  $project: {
                    _id: 0,
                    bucket: {
                      $dateToString: { format: dateFormat, date: "$_id", timezone: "UTC" },
                    },
                    pageviews: 1,
                    authenticatedPageviews: 1,
                    visits: { $size: "$visitorSet" },
                  },
                },
              ],
              topPaths: [
                {
                  $group: {
                    _id: "$path",
                    views: { $sum: 1 },
                    visitorSet: { $addToSet: "$visitorId" },
                  },
                },
                { $sort: { views: -1 } },
                { $limit: 15 },
                { $project: { _id: 0, path: "$_id", views: 1, visits: { $size: "$visitorSet" } } },
              ],
              totals: [
                {
                  $group: {
                    _id: null,
                    pageviews: { $sum: 1 },
                    authenticatedPageviews: { $sum: { $cond: ["$authenticated", 1, 0] } },
                    visitors: { $addToSet: "$visitorId" },
                  },
                },
                {
                  $project: {
                    _id: 0,
                    pageviews: 1,
                    authenticatedPageviews: 1,
                    visits: { $size: "$visitors" },
                  },
                },
              ],
              byCountry: [
                {
                  $group: {
                    _id: { $ifNull: ["$country", "ZZ"] },
                    views: { $sum: 1 },
                    visitorSet: { $addToSet: "$visitorId" },
                  },
                },
                { $sort: { views: -1 } },
                { $limit: 12 },
                {
                  $project: {
                    _id: 0,
                    country: "$_id",
                    views: 1,
                    visits: { $size: "$visitorSet" },
                  },
                },
              ],
              byDevice: [
                {
                  $group: {
                    _id: { $ifNull: ["$deviceType", "other"] },
                    views: { $sum: 1 },
                    visitorSet: { $addToSet: "$visitorId" },
                  },
                },
                { $sort: { views: -1 } },
                {
                  $project: {
                    _id: 0,
                    deviceType: "$_id",
                    views: 1,
                    visits: { $size: "$visitorSet" },
                  },
                },
              ],
              byWeekday: [
                {
                  // $dayOfWeek: 1=Sunday..7=Saturday. We convert to 0=Mon..6=Sun in JS.
                  $group: {
                    _id: { $dayOfWeek: { date: "$recordedAt", timezone: "America/New_York" } },
                    views: { $sum: 1 },
                  },
                },
                { $project: { _id: 0, dow: "$_id", views: 1 } },
              ],
              bySlot: [
                {
                  // Bucket hour-of-day into 6h windows in EST.
                  $group: {
                    _id: {
                      $floor: {
                        $divide: [
                          { $hour: { date: "$recordedAt", timezone: "America/New_York" } },
                          6,
                        ],
                      },
                    },
                    views: { $sum: 1 },
                  },
                },
                { $project: { _id: 0, slot: "$_id", views: 1 } },
              ],
              slowestPaths: [
                { $match: { loadTimeMs: { $gt: 0 } } },
                {
                  $group: {
                    _id: "$path",
                    avgMs: { $avg: "$loadTimeMs" },
                    samples: { $sum: 1 },
                  },
                },
                // Ignore noisy paths with barely any samples.
                { $match: { samples: { $gte: 3 } } },
                { $sort: { avgMs: -1 } },
                { $limit: 10 },
                {
                  $project: {
                    _id: 0,
                    path: "$_id",
                    avgMs: { $round: ["$avgMs", 0] },
                    samples: 1,
                  },
                },
              ],
            },
          },
        ])
        .toArray(),
      checkIntegrated(coll),
    ]);

    const facet =
      rows[0] ??
      ({
        daily: [],
        topPaths: [],
        totals: [],
        byCountry: [],
        byDevice: [],
        byWeekday: [],
        bySlot: [],
        slowestPaths: [],
      } as FacetShape);
    const totals = facet.totals[0] ?? {
      pageviews: 0,
      visits: 0,
      authenticatedPageviews: 0,
    };

    return NextResponse.json({
      resolution: range.resolution,
      bucketCount: range.bucketCount,
      rangeLabel: range.label,
      rangeStart: range.start.toISOString(),
      // Keep the legacy `days` field populated when the caller asked for days;
      // the admin UI currently reads it for legacy chart rendering.
      days: range.resolution === "day" ? range.bucketCount : 0,
      hours: range.resolution === "hour" ? range.bucketCount : 0,
      daily: facet.daily,
      topPaths: facet.topPaths,
      totals,
      byCountry: facet.byCountry,
      byDevice: facet.byDevice,
      byWeekday: facet.byWeekday,
      bySlot: facet.bySlot,
      slowestPaths: facet.slowestPaths,
      integrated,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

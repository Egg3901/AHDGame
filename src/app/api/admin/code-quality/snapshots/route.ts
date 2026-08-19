import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { withAdminAuth } from "@/lib/api/withAdminAuth";
import { requireAdminOrApiKey } from "@/lib/api/requireAdminOrApiKey";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { z } from "zod";

const snapshotSchema = z.object({
  environment: z.enum(["localhost", "staging", "production"]),
  gitSha: z.string().min(1),
  gitBranch: z.string().min(1),
  overallScore: z.number().min(0).max(100),
  mobileScore: z.number().min(0).max(100),
  lint: z.object({
    errorCount: z.number(),
    warningCount: z.number(),
    byRule: z.record(z.string(), z.number()),
  }),
  typescript: z.object({ errorCount: z.number() }),
  tests: z.object({
    total: z.number(),
    passed: z.number(),
    failed: z.number(),
    skipped: z.number(),
    coveragePercent: z.number(),
  }),
  format: z.object({ violationCount: z.number() }),
  bundle: z.object({
    buildSuccess: z.boolean(),
    totalSizeBytes: z.number(),
    mobileSizeBytes: z.number(),
    pageSizes: z.record(z.string(), z.number()),
  }),
  dependencies: z.object({
    outdatedCount: z.number(),
    vulnerabilities: z.object({
      critical: z.number(),
      high: z.number(),
      moderate: z.number(),
      low: z.number(),
    }),
  }),
});

/**
 * GET: List code quality snapshots. POST: Ingest from build script.
 * Auth: GET requires requireAdmin(), POST requires requireAdminOrApiKey()
 * Errors: 400, 401, 403, 500
 */
export const GET = withAdminAuth(async (_auth, request: Request) => {
  try {
    const url = new URL(request.url);
    const limit = Math.min(Number(url.searchParams.get("limit")) || 10, 50);
    const environment = url.searchParams.get("environment") || undefined;

    const db = await getDb();
    const filter: Record<string, unknown> = {};
    if (environment) filter.environment = environment;

    const snapshots = await db
      .collection("codeQualitySnapshots")
      .find(filter)
      .sort({ timestamp: -1 })
      .limit(limit)
      .toArray();

    return NextResponse.json({ snapshots });
  } catch (error) {
    return handleRouteError(error);
  }
});

export async function POST(request: Request) {
  try {
    const auth = await requireAdminOrApiKey(request);
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, snapshotSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();
    await db.collection("codeQualitySnapshots").insertOne({
      ...parsed.data,
      timestamp: new Date(),
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}

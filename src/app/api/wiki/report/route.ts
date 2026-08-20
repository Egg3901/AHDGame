import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getAuthUser } from "@/lib/auth";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { wikiReportSchema } from "@/lib/api/schemas/wiki";
import { checkWikiDisabled } from "@/lib/api/wikiGuard";
import { checkRateLimit, rateLimitResponse, WIKI_REPORT_LIMITS } from "@/lib/api/rateLimit";
import { logRequest } from "@/lib/api/requestLog";
import { clientIpFromRequest } from "@/lib/utils/network";
import { getWikiReportsCollection } from "@/lib/db/collections";
import type { WikiReport } from "@/lib/db/types";

const RELAY_TIMEOUT_MS = 3000;

/**
 * Fire-and-forget POST to WIKI_REPORT_ENDPOINT when set.
 * 3s timeout; failures are swallowed so the player still gets 200.
 */
function relayWikiReport(payload: Record<string, unknown>): void {
  const endpoint = process.env.WIKI_REPORT_ENDPOINT?.trim();
  if (!endpoint) return;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RELAY_TIMEOUT_MS);
  fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: controller.signal,
  })
    .catch((err: unknown) => {
      console.warn("[wiki-report] relay failed:", err);
    })
    .finally(() => clearTimeout(timer));
}

// POST /api/wiki/report: records a wiki page issue (stale / incorrect / update / other).
// Auth: public (optional session); blocked when wiki is disabled
// Errors: 400, 403, 429
export async function POST(request: Request) {
  const start = Date.now();
  const path = new URL(request.url).pathname;
  try {
    const blocked = await checkWikiDisabled();
    if (blocked) {
      logRequest("POST", path, 403, Date.now() - start);
      return blocked;
    }

    const ip = clientIpFromRequest(request);
    const rateLimit = checkRateLimit(
      `wiki-report:${ip}`,
      WIKI_REPORT_LIMITS.maxRequests,
      WIKI_REPORT_LIMITS.windowMs
    );
    if (!rateLimit.ok) {
      logRequest("POST", path, 429, Date.now() - start);
      return rateLimitResponse(rateLimit.retryAfter, undefined, rateLimit);
    }

    const parsed = await parseJsonBody(request, wikiReportSchema);
    if (!parsed.success) {
      logRequest("POST", path, parsed.status, Date.now() - start);
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const user = await getAuthUser().catch(() => null);
    const now = new Date();
    const doc: Omit<WikiReport, "_id"> = {
      slug: parsed.data.slug,
      reason: parsed.data.reason,
      note: parsed.data.note.trim(),
      ip,
      userId: user?.userId ? new ObjectId(user.userId) : undefined,
      createdAt: now,
      relayAttempted: Boolean(process.env.WIKI_REPORT_ENDPOINT?.trim()),
    };

    const db = await getDb();
    const coll = getWikiReportsCollection(db);
    await coll.insertOne(doc as WikiReport);

    relayWikiReport({
      slug: doc.slug,
      reason: doc.reason,
      note: doc.note,
      createdAt: now.toISOString(),
    });

    logRequest("POST", path, 200, Date.now() - start);
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}

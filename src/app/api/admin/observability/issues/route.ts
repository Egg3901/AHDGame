/**
 * Admin observability API — proxies the Sentry-compatible issue list.
 *
 * GET /api/admin/observability/issues
 * Returns recent Sentry issues for the admin observability tab.
 * Requires admin auth.
 */
import { NextResponse } from "next/server";
import { getAuthAdmin } from "@/lib/auth";
import { handleRouteError } from "@/lib/api/errors";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await getAuthAdmin();
    if (!user) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const baseUrl = process.env.SENTRY_API_URL?.replace(/\/+$/, "");
    const orgSlug = process.env.SENTRY_ORG ?? "lakeside-games";
    const token = process.env.SENTRY_API_TOKEN;

    if (!token || !baseUrl) {
      return NextResponse.json({
        configured: false,
        issues: [],
        message: "SENTRY_API_TOKEN or SENTRY_API_URL not configured",
      });
    }

    // Fetch recent issues from the selected Sentry-compatible API.
    const url = `${baseUrl}/api/0/organizations/${orgSlug}/issues/?limit=25&sort=date&statsPeriod=24h`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      next: { revalidate: 30 },
    });

    if (!res.ok) {
      return NextResponse.json(
        {
          configured: true,
          issues: [],
          error: `Sentry API returned ${res.status}`,
        },
        { status: 200 }
      );
    }

    const issues = await res.json();
    return NextResponse.json({ configured: true, issues });
  } catch (error) {
    return handleRouteError(error, { route: "/api/admin/observability/issues" });
  }
}

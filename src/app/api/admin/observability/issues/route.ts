/**
 * Admin observability API — proxies GlitchTip issue list.
 *
 * GET /api/admin/observability/issues
 * Returns recent GlitchTip issues for the admin observability tab.
 * Requires admin auth.
 */
import { NextResponse } from "next/server";
import { getAuthAdmin } from "@/lib/auth";
import { handleRouteError } from "@/lib/api/errors";
import { getGlitchTipBaseUrl } from "@/lib/observability/glitchtip";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await getAuthAdmin();
    if (!user) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const baseUrl = getGlitchTipBaseUrl();
    if (!baseUrl) {
      return NextResponse.json({
        configured: false,
        issues: [],
        message: "GLITCHTIP_URL not configured",
      });
    }

    const orgSlug = process.env.GLITCHTIP_ORG_SLUG ?? "ahd";
    const token = process.env.GLITCHTIP_API_TOKEN;

    if (!token) {
      return NextResponse.json({
        configured: false,
        issues: [],
        message: "GLITCHTIP_API_TOKEN not configured",
      });
    }

    // Fetch recent issues from GlitchTip API
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
          error: `GlitchTip API returned ${res.status}`,
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

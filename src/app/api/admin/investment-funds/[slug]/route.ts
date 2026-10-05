import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError, notFound, errorResponse } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { isIndexFundsEnabled, INDEX_FUNDS_DISABLED_MESSAGE } from "@/lib/indexFunds/featureFlag";
import { resolveFundBySlugOrId, setFundStatus } from "@/lib/indexFunds/fundQueries";
import { createAdminLog } from "@/lib/adminLog";
import type { IndexFund } from "@/lib/db/types";

const pauseSchema = z.object({
  status: z.enum(["active", "paused", "delisted"]),
  pauseReason: z.string().optional(),
});

// GET /api/admin/investment-funds/[slug] — Admin fund detail
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    if (!(await isIndexFundsEnabled())) {
      return errorResponse(403, INDEX_FUNDS_DISABLED_MESSAGE);
    }

    const { slug } = await params;
    const fund = await resolveFundBySlugOrId(db, slug);
    if (!fund) throw notFound("Fund not found");

    return NextResponse.json({ fund });
  } catch (error) {
    return handleRouteError(error);
  }
}

// PATCH /api/admin/investment-funds/[slug] — Admin pause/resume/retire a fund
export async function PATCH(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, pauseSchema);
    if (!parsed.success) {
      return errorResponse(parsed.status, parsed.error);
    }

    const db = await getDb();
    if (!(await isIndexFundsEnabled())) {
      return errorResponse(403, INDEX_FUNDS_DISABLED_MESSAGE);
    }

    const { slug } = await params;
    const fund = await resolveFundBySlugOrId(db, slug);
    if (!fund) throw notFound("Fund not found");

    const { status, pauseReason } = parsed.data;

    if (status === "paused" && fund.status === "paused") {
      return errorResponse(400, "Fund is already paused");
    }
    if (status === "delisted" && fund.status === "delisted") {
      return errorResponse(400, "Fund is already delisted");
    }

    const reason =
      status === "paused" ? ((pauseReason as IndexFund["pauseReason"]) ?? "manual") : undefined;
    await setFundStatus(db, fund._id, status, reason);

    const adminLogAction = `index_fund_${status}` as const;
    await createAdminLog({
      category: "system",
      action: adminLogAction,
      username: auth.admin.username,
      adminUsername: auth.admin.username,
      details: `Fund ${fund.slug} set to ${status}${reason ? ` (reason: ${reason})` : ""}`,
    });

    return NextResponse.json({ success: true, status, slug: fund.slug });
  } catch (error) {
    return handleRouteError(error);
  }
}

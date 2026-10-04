import { createAdminLog } from "@/lib/adminLog";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { setConstructionFinanceEnabled } from "@/lib/banking/constructionAdmission";

/** Finance disable must leave no cash receipt or site pledge behind. */
export async function PATCH(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const body = await parseJsonBody(request, z.object({ enabled: z.boolean() }).strict());
    if (!body.success) return NextResponse.json({ error: body.error }, { status: body.status });
    const result = await setConstructionFinanceEnabled(await getDb(), body.data.enabled);
    if (result.ok)
      await createAdminLog({
        category: "system",
        action: body.data.enabled
          ? "construction_finance_enabled"
          : "construction_finance_disabled",
        username: auth.admin.username,
        adminUsername: auth.admin.username,
        details: `Construction finance enabled: ${body.data.enabled}`,
      });
    return NextResponse.json(result.ok ? { enabled: body.data.enabled } : { error: result.error }, {
      status: result.ok ? 200 : 409,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

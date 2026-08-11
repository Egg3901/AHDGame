// POST /api/admin/country/[code]/central-bank/admin/chair-controls — Lock or unlock chair-only CB controls
// Auth: requireAdmin
// Errors: 400, 403, 404

import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError, notFound } from "@/lib/api/errors";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import type { CentralBank } from "@/lib/db/types";
import { createAdminLog } from "@/lib/adminLog";
import {
  notifyImfMonetarySupervisionDiscord,
  notifyImfMonetarySupervisionLiftedDiscord,
} from "@/lib/centralBankChairEvents";
import { getBankId } from "@/lib/centralBank/helpers";

const schema = z.object({
  locked: z.boolean(),
});

interface RouteContext {
  params: Promise<{ code: string }>;
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { code } = await context.params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId])
      return NextResponse.json(notFound("Country not found").toJson(), { status: 404 });

    const parsed = await parseJsonBody(request, schema);
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });

    const db = await getDb();
    const bankId = getBankId(countryId);
    const bank = await db.collection<CentralBank>("centralBanks").findOne({ _id: bankId });
    if (!bank)
      return NextResponse.json(notFound("Central bank not found").toJson(), { status: 404 });

    const previous = bank.chairControlsLocked === true;
    if (previous === parsed.data.locked) {
      return NextResponse.json(
        {
          error: parsed.data.locked
            ? "Chair controls are already locked"
            : "Chair controls are already unlocked",
        },
        { status: 400 }
      );
    }

    await db.collection<CentralBank>("centralBanks").updateOne(
      { _id: bankId },
      {
        $set: {
          chairControlsLocked: parsed.data.locked,
          updatedAt: new Date(),
        },
      }
    );

    await createAdminLog({
      category: "system",
      action: "central_bank_chair_controls_locked",
      username: auth.admin.username ?? "unknown",
      adminUsername: auth.admin.username ?? undefined,
      details: `${countryId}: chair controls ${parsed.data.locked ? "locked" : "unlocked"}`,
    });

    if (parsed.data.locked) {
      notifyImfMonetarySupervisionDiscord(countryId).catch((err) =>
        console.error("[chair-controls] IMF supervision webhook failed:", err)
      );
    } else {
      notifyImfMonetarySupervisionLiftedDiscord(countryId).catch((err) =>
        console.error("[chair-controls] IMF supervision lifted webhook failed:", err)
      );
    }

    return NextResponse.json({ success: true, chairControlsLocked: parsed.data.locked });
  } catch (error) {
    return handleRouteError(error);
  }
}

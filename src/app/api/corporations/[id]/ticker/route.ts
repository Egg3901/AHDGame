import { z } from "zod";
import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/errors";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { requireCorporationActionsEnabled } from "@/lib/api/requireCorporationActions";
import { parseJsonBody } from "@/lib/api/validate";
import { getDb } from "@/lib/mongodb";
import { resolveCorporation, requireCeo } from "@/lib/api/corporations/resolveQuery";

const TickerSchema = z.object({
  newTicker: z
    .string()
    .min(1, "Ticker must be at least 1 character")
    .max(5, "Ticker cannot exceed 5 characters")
    .regex(/^[A-Z]+$/, "Ticker must be uppercase letters only"),
});

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const { id } = await params;
    const db = await getDb();

    const actionsGuard = await requireCorporationActionsEnabled(db);
    if (actionsGuard) return actionsGuard;

    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;

    const ceoCheck = requireCeo(corporation, auth.user.userId);
    if (ceoCheck) return ceoCheck;

    if (!corporation.isPrivate) {
      return NextResponse.json(
        { error: "Public corporations must use a shareholder vote to change their ticker" },
        { status: 400 }
      );
    }

    const parsed = await parseJsonBody(request, TickerSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { newTicker } = parsed.data;

    if (newTicker === corporation.tickerSymbol) {
      return NextResponse.json({ error: "That is already your ticker symbol" }, { status: 400 });
    }

    const conflict = await db
      .collection("corporations")
      .findOne({ tickerSymbol: newTicker, _id: { $ne: corporation._id } });
    if (conflict) {
      return NextResponse.json(
        { error: "That ticker is already in use by another corporation" },
        { status: 409 }
      );
    }

    await db
      .collection("corporations")
      .updateOne(
        { _id: corporation._id },
        { $set: { tickerSymbol: newTicker, updatedAt: new Date() } }
      );

    return NextResponse.json({ tickerSymbol: newTicker });
  } catch (e) {
    return handleRouteError(e);
  }
}

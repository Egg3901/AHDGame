import { NextResponse } from "next/server";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import { primaryMetricById } from "@/lib/resetMetrics/catalog";
import { readResetMetricBoard } from "@/lib/resetMetrics/readBoard";
import { readResetMetricDetail } from "@/lib/resetMetrics/readMetricDetail";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ code: string; metricId: string }> }
) {
  try {
    const { code, metricId } = await params;
    const countryId = code.toUpperCase();
    if (
      (countryId !== "US" && countryId !== "UK" && countryId !== "JP") ||
      !primaryMetricById(metricId)
    ) {
      return errorResponse(404, "V2 metric was not found");
    }
    const regionId = new URL(request.url).searchParams.get("region") ?? undefined;
    const db = await getDb();
    const board = await readResetMetricBoard(db, countryId, regionId);
    if (board.status === "not_enabled") {
      return errorResponse(409, "V2 metrics are not enabled");
    }
    if (board.status !== "ready") {
      return errorResponse(503, "V2 metrics board is unavailable", {
        extra: { reason: board.status },
        headers: { "Cache-Control": "no-store" },
      });
    }
    const detail = await readResetMetricDetail(db, board.board, metricId);
    if (!detail) {
      return errorResponse(503, "V2 metric detail is unavailable", {
        headers: { "Cache-Control": "no-store" },
      });
    }
    return NextResponse.json(detail, {
      headers: { "Cache-Control": "no-store, no-transform" },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

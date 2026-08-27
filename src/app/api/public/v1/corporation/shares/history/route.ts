import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { publicApiGuard } from "@/lib/publicApi/middleware";
import { queryShareHistory } from "@/lib/publicApi/corporation";

// GET /api/public/v1/corporation/shares/history?name=X&id=N&page=&pageSize=
export async function GET(request: Request) {
  try {
    const guard = await publicApiGuard(request, "share-history");
    if (!guard.ok) return guard.response;

    const url = new URL(request.url);
    const name = url.searchParams.get("name");
    const id = url.searchParams.get("id");
    if (!name && !id) {
      return NextResponse.json(
        {
          ok: false,
          error: "Missing required query param: name or id",
          code: "BAD_REQUEST",
        },
        { status: 400 }
      );
    }

    const db = await getDb();
    const result = await queryShareHistory(db, {
      name: name ?? undefined,
      id: id ?? undefined,
      page: url.searchParams.get("page") ? Number(url.searchParams.get("page")) : undefined,
      pageSize: url.searchParams.get("pageSize")
        ? Number(url.searchParams.get("pageSize"))
        : undefined,
    });

    if (!result) {
      return NextResponse.json(
        { ok: false, error: "Corporation not found", code: "NOT_FOUND" },
        { status: 404 }
      );
    }

    return NextResponse.json({ ok: true, ...result }, { headers: guard.headers });
  } catch (error) {
    return handleRouteError(error);
  }
}

import { errorResponse } from "@/lib/api/errors";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import {
  CLIENT_DIAGNOSTICS_COLLECTION,
  CLIENT_DIAGNOSTICS_MAX_BYTES,
  clientDiagnosticSchema,
  toClientDiagnosticDocument,
} from "@/lib/clientDiagnostics";

export const dynamic = "force-dynamic";
let windowStartedAt = 0;
let receivedInWindow = 0;

function acceptWithinGlobalBudget(now: number): boolean {
  if (now - windowStartedAt >= 60_000) {
    windowStartedAt = now;
    receivedInWindow = 0;
  }
  receivedInWindow += 1;
  return receivedInWindow <= 120;
}

export async function POST(request: Request) {
  if (!acceptWithinGlobalBudget(Date.now())) return errorResponse(429, "Try again later");
  if (request.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json")
    return errorResponse(415, "Unsupported content type");
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > CLIENT_DIAGNOSTICS_MAX_BYTES) return errorResponse(413, "Request body too large");
  let raw: unknown;
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > CLIENT_DIAGNOSTICS_MAX_BYTES)
      return errorResponse(413, "Request body too large");
    raw = JSON.parse(text);
  } catch {
    return errorResponse(400, "Invalid report");
  }
  const parsed = clientDiagnosticSchema.safeParse(raw);
  if (!parsed.success) return errorResponse(400, "Invalid report");
  try {
    await (
      await getDb()
    )
      .collection(CLIENT_DIAGNOSTICS_COLLECTION)
      .insertOne(toClientDiagnosticDocument(parsed.data));
  } catch {
    return errorResponse(500, "Unable to store report");
  }
  return NextResponse.json({ ok: true }, { status: 202, headers: { "Cache-Control": "no-store" } });
}

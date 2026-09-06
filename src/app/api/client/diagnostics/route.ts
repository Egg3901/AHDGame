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
  if (!acceptWithinGlobalBudget(Date.now()))
    return NextResponse.json({ error: "Try again later" }, { status: 429 });
  if (request.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json")
    return NextResponse.json({ error: "Unsupported content type" }, { status: 415 });
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > CLIENT_DIAGNOSTICS_MAX_BYTES)
    return NextResponse.json({ error: "Request body too large" }, { status: 413 });
  let raw: unknown;
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > CLIENT_DIAGNOSTICS_MAX_BYTES)
      return NextResponse.json({ error: "Request body too large" }, { status: 413 });
    raw = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Invalid report" }, { status: 400 });
  }
  const parsed = clientDiagnosticSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "Invalid report" }, { status: 400 });
  try {
    await (
      await getDb()
    )
      .collection(CLIENT_DIAGNOSTICS_COLLECTION)
      .insertOne(toClientDiagnosticDocument(parsed.data));
  } catch {
    return NextResponse.json({ error: "Unable to store report" }, { status: 500 });
  }
  return NextResponse.json({ ok: true }, { status: 202, headers: { "Cache-Control": "no-store" } });
}

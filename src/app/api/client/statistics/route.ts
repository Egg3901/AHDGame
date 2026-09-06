import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import {
  COLLECTION_NAME,
  MAX_BODY_BYTES,
  clientStatisticsReportSchema,
  toStoredDocument,
  type ClientSimulationStatisticsDoc,
} from "@/lib/clientStatistics";

export const dynamic = "force-dynamic";
// Bound anonymous ingress without keeping per-IP or account identifiers.
let windowStartedAt = 0;
let receivedInWindow = 0;
function acceptWithinGlobalBudget(now: number): boolean {
  if (now - windowStartedAt >= 60_000) {
    windowStartedAt = now;
    receivedInWindow = 0;
  }
  receivedInWindow += 1;
  return receivedInWindow <= 300;
}

/**
 * Anonymous aggregate statistics ingress for opt-in desktop telemetry.
 *
 * Privacy contract: no auth, no account ids, no names, no cookies are read
 * here, and the client IP is never retained. Failures return generic errors
 * and never log the payload or the IP. The ack is a minimal 202 with
 * no-store. The receiving proxy and access-log retention are deployment
 * config; this handler alone cannot guarantee them.
 *
 * TTL ops note: documents carry `expiresAt` (30 days). The TTL index
 * `db.clientSimulationStatistics.createIndex({ expiresAt: 1 },
 * { expireAfterSeconds: 0 })` must be created by deployment/migration. It is
 * deliberately NOT created per request.
 */

/** Stream the body with a hard byte cap so oversized payloads die early. */
async function readCappedBody(request: Request, maxBytes: number): Promise<string | null> {
  const declared = parseInt(request.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  if (!request.body) {
    const text = await request.text();
    return new TextEncoder().encode(text).byteLength > maxBytes ? null : text;
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(merged);
}

function noStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function POST(request: Request) {
  if (!acceptWithinGlobalBudget(Date.now()))
    return noStore(NextResponse.json({ error: "Try again later" }, { status: 429 }));
  const contentType = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    return noStore(NextResponse.json({ error: "Unsupported content type" }, { status: 415 }));
  }

  let text: string | null;
  try {
    text = await readCappedBody(request, MAX_BODY_BYTES);
  } catch {
    return noStore(NextResponse.json({ error: "Invalid report" }, { status: 400 }));
  }
  if (text === null) {
    return noStore(NextResponse.json({ error: "Request body too large" }, { status: 413 }));
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return noStore(NextResponse.json({ error: "Invalid report" }, { status: 400 }));
  }

  const parsed = clientStatisticsReportSchema.safeParse(raw);
  if (!parsed.success) {
    return noStore(NextResponse.json({ error: "Invalid report" }, { status: 400 }));
  }

  try {
    const db = await getDb();
    await db
      .collection<ClientSimulationStatisticsDoc>(COLLECTION_NAME)
      .insertOne(toStoredDocument(parsed.data, Date.now()));
  } catch {
    return noStore(NextResponse.json({ error: "Unable to store report" }, { status: 500 }));
  }

  return noStore(NextResponse.json({ ok: true }, { status: 202 }));
}

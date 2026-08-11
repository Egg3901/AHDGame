import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { getCharacterByUserId } from "@/lib/db/characterLookup";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import type { Impeachment } from "@/lib/db/types/impeachment";
import { fileArticlesOfImpeachment } from "@/lib/impeachment/fileArticles";

const fileSchema = z.object({
  countryId: z.string().min(1),
  office: z.enum(["president", "governor"]).optional().default("president"),
  state: z.string().optional(),
  // Required for president; optional for governor (resolved from state).
  targetCharacterId: z
    .string()
    .refine((v) => ObjectId.isValid(v), "Invalid character id")
    .optional(),
});

// GET /api/impeachments?countryId=US[&targetCharacterId=...] — list recent
// impeachments for a country (most recent first). Public read.
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const countryId = url.searchParams.get("countryId");
    if (!countryId || !(countryId in COUNTRY_CONFIGS)) {
      return NextResponse.json({ error: "Unknown or missing countryId" }, { status: 400 });
    }
    const targetCharacterId = url.searchParams.get("targetCharacterId");
    const query: Record<string, unknown> = { countryId };
    if (targetCharacterId && ObjectId.isValid(targetCharacterId)) {
      query.targetCharacterId = new ObjectId(targetCharacterId);
    }
    // Governor cases are looked up by state + office (the client need not know
    // the sitting governor's characterId).
    const office = url.searchParams.get("office");
    const state = url.searchParams.get("state");
    if (office === "governor") query.targetOffice = "governor";
    if (state) query.state = state;

    const db = await getDb();
    const impeachments = await db
      .collection<Impeachment>("impeachments")
      .find(query)
      .sort({ createdAt: -1 })
      .limit(20)
      .toArray();

    return NextResponse.json({ impeachments });
  } catch (error) {
    return handleRouteError(error);
  }
}

// POST /api/impeachments — file articles of impeachment against the sitting president.
export async function POST(request: Request) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, fileSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { countryId, office, state, targetCharacterId } = parsed.data;
    if (!(countryId in COUNTRY_CONFIGS)) {
      return NextResponse.json({ error: "Unknown countryId" }, { status: 400 });
    }

    const db = await getDb();
    const character = await getCharacterByUserId(db, auth.user.userId);
    if (!character) {
      return NextResponse.json({ error: "No character" }, { status: 400 });
    }

    const result = await fileArticlesOfImpeachment(
      db,
      countryId as CountryId,
      character,
      auth.user.isAdmin === true,
      {
        office,
        state,
        targetCharacterId: targetCharacterId ? new ObjectId(targetCharacterId) : undefined,
      }
    );
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return handleRouteError(error);
  }
}

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
import {
  countChamberSeats,
  houseImpeachmentVotesNeeded,
  senateConvictionVotesNeeded,
  impeachmentStageChamberOfficeType,
} from "@/lib/impeachment/impeachmentTally";

/** The all-seats bar a player needs to read a vote in progress. */
export interface ImpeachmentChamberInfo {
  seats: number;
  needed: number;
}

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

    // Attach the all-seats bar (chamber size + ayes needed) for every open
    // case so the panel can show what passage actually takes. Seat counts are
    // memoized per chamber; most requests touch one or two. Cache the PROMISE,
    // not the resolved count: these callbacks all run to their first await
    // before any of them resolves, so caching the number would let every case
    // in the same chamber issue its own duplicate seat scan.
    const seatCache = new Map<string, Promise<number>>();
    const chambers = await Promise.all(
      impeachments.map(async (imp): Promise<ImpeachmentChamberInfo | null> => {
        if (imp.stage !== "house" && imp.stage !== "senate") return null;
        const officeType = impeachmentStageChamberOfficeType(imp);
        if (!officeType) return null;
        const stateScope = imp.targetOffice === "governor" ? (imp.state ?? "") : "";
        const cacheKey = `${officeType}|${stateScope}`;
        let pending = seatCache.get(cacheKey);
        if (!pending) {
          pending = countChamberSeats(db, imp.countryId, officeType, stateScope || undefined);
          seatCache.set(cacheKey, pending);
        }
        const seats = await pending;
        return {
          seats,
          needed:
            imp.stage === "house"
              ? houseImpeachmentVotesNeeded(seats)
              : senateConvictionVotesNeeded(seats),
        };
      })
    );

    return NextResponse.json({
      impeachments: impeachments.map((imp, i) => ({ ...imp, chamber: chambers[i] })),
    });
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

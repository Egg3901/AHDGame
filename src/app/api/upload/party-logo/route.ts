import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { findPartyBySequentialId, getPartyIdString, parseCountryParam } from "@/lib/db/partyLookup";
import { canActAsChair } from "@/lib/parties/actingChair";
import type { Character, PoliticalParty } from "@/lib/db/types";
import { optimizeImage, IMAGE_PRESETS } from "@/lib/imageOptimize";
import { isR2Enabled, uploadFile, deleteByPrefix } from "@/lib/r2";
import { parseFormData } from "@/lib/api/validate";
import {
  getLocalPartyLogoFilenamePrefix,
  getPartyLogoFilename,
  getPartyLogoStoragePrefix,
} from "@/lib/partyLogoStorage";

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_SIZE = 2 * 1024 * 1024; // 2 MB

// POST /api/upload/party-logo — Uploads a party logo image; only the party Chair is authorized to upload.
// Auth: requireBasicAuth
// Errors: 400, 401, 403, 404, 429
export async function POST(request: Request) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;
    const authUser = auth.user;

    const rateLimit = checkRateLimit(authUser.userId, 10, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const parsed = await parseFormData(request);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const formData = parsed.data;
    const file = formData.get("file");
    const partyId = formData.get("partyId");

    if (!partyId || typeof partyId !== "string") {
      return NextResponse.json({ error: "Party ID required" }, { status: 400 });
    }

    const countryRaw = formData.get("country");
    const countryId = parseCountryParam(typeof countryRaw === "string" ? countryRaw : null);
    if (!countryId) {
      return NextResponse.json({ error: "Country parameter required" }, { status: 400 });
    }

    if (!file || !(file instanceof Blob)) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }
    if (!ALLOWED_TYPES.has(file.type)) {
      return NextResponse.json(
        { error: "Only JPEG, PNG, WebP, and GIF images are allowed." },
        { status: 400 }
      );
    }
    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: "File must be under 2 MB." }, { status: 400 });
    }

    const db = await getDb();

    // Verify user is the party Chair
    const character = await db.collection<Character>("characters").findOne({
      userId: new ObjectId(authUser.userId),
    });
    if (!character) {
      return NextResponse.json({ error: "No character found" }, { status: 400 });
    }

    const party = await findPartyBySequentialId(db, partyId, countryId);
    if (!party) {
      return NextResponse.json({ error: "Party not found" }, { status: 404 });
    }
    const canonicalPartyId = getPartyIdString(party);

    // Chair authority — VC may act when the chair seat is vacant.
    if (!canActAsChair(party, character._id)) {
      return NextResponse.json(
        {
          error:
            "Only the party Chair (or acting Vice-Chair when the chair seat is vacant) can upload a logo",
        },
        { status: 403 }
      );
    }

    const rawBuffer = Buffer.from(await file.arrayBuffer());
    const { buffer: optimized, ext } = await optimizeImage(
      rawBuffer,
      file.type,
      IMAGE_PRESETS.partyLogo
    );

    const timestamp = Date.now();
    let url: string;

    if (isR2Enabled()) {
      try {
        await deleteByPrefix(getPartyLogoStoragePrefix(countryId, canonicalPartyId));
      } catch {
        /* ignore delete errors */
      }

      url = await uploadFile(
        getPartyLogoFilename(countryId, canonicalPartyId, timestamp, ext),
        optimized
      );
    } else {
      const fs = await import("fs/promises");
      const path = await import("path");

      const uploadsDir = path.join(process.cwd(), "uploads", "party-logos");
      await fs.mkdir(uploadsDir, { recursive: true });

      try {
        const files = await fs.readdir(uploadsDir);
        const partyPrefix = getLocalPartyLogoFilenamePrefix(countryId, canonicalPartyId);
        const oldFiles = files.filter((f) => f.startsWith(partyPrefix));
        await Promise.all(oldFiles.map((f) => fs.unlink(path.join(uploadsDir, f)).catch(() => {})));
      } catch {
        /* ignore */
      }

      const filename = getPartyLogoFilename(countryId, canonicalPartyId, timestamp, ext).replace(
        "party-logos/",
        ""
      );
      const filePath = path.join(uploadsDir, filename);
      await fs.writeFile(filePath, optimized);

      url = `/api/uploads/party-logos/${filename}`;
    }

    // Update party record
    await db
      .collection<PoliticalParty>("politicalParties")
      .updateOne({ _id: party._id }, { $set: { logoUrl: url, updatedAt: new Date() } });

    return NextResponse.json({ url });
  } catch (error) {
    return handleRouteError(error);
  }
}

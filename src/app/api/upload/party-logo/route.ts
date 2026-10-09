import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { findPartyBySequentialId, getPartyIdString, parseCountryParam } from "@/lib/db/partyLookup";
import { canActAsChair } from "@/lib/parties/actingChair";
import type { PoliticalParty } from "@/lib/db/types";
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
// Auth: requireAuthWithCharacter
// Errors: 400, 401, 403, 404, 429
export async function POST(request: Request) {
  try {
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;
    const authUser = auth.user;
    // The active character, not the first character found by userId, so an
    // account with more than one character is checked as the one it plays.
    const character = authUser.character;

    const rateLimit = checkRateLimit(authUser.userId, 10, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const parsed = await parseFormData(request);
    if (!parsed.success) {
      return errorResponse(parsed.status, parsed.error);
    }
    const formData = parsed.data;
    const file = formData.get("file");
    const partyId = formData.get("partyId");

    if (!partyId || typeof partyId !== "string") {
      return errorResponse(400, "Party ID required");
    }

    const countryRaw = formData.get("country");
    const countryId = parseCountryParam(typeof countryRaw === "string" ? countryRaw : null);
    if (!countryId) {
      return errorResponse(400, "Country parameter required");
    }

    if (!file || !(file instanceof Blob)) {
      return errorResponse(400, "No file uploaded");
    }
    if (!ALLOWED_TYPES.has(file.type)) {
      return errorResponse(400, "Only JPEG, PNG, WebP, and GIF images are allowed.");
    }
    if (file.size > MAX_SIZE) {
      return errorResponse(400, "File must be under 2 MB.");
    }

    const db = await getDb();

    const party = await findPartyBySequentialId(db, partyId, countryId);
    if (!party) {
      return errorResponse(404, "Party not found");
    }
    const canonicalPartyId = getPartyIdString(party);

    // Chair authority — VC may act when the chair seat is vacant.
    if (!canActAsChair(party, character._id)) {
      return errorResponse(
        403,
        "Only the party Chair (or acting Vice-Chair when the chair seat is vacant) can upload a logo"
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

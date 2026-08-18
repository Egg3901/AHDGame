// GET /api/admin/alts/link/[pair] — one pairwise alt-detection link
// Auth: requireModerator (mods and admins both read; plan §4.6)
// Errors: 400, 403, 404
//
// `pair` is two hex ObjectIds joined by an underscore, in either order,
// e.g. `507f1f77bcf86cd799439011_507f191e810c19729de860ea`.
//
// Frozen contract (forensics/alt-detection rework plan §4.9):
//   GET /api/admin/alts/link/:pair
//     -> { userA, userB, confidence, signals:[{type,weight,contribution,evidence}] }
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireModerator } from "@/lib/api/requireModerator";
import { handleRouteError } from "@/lib/api/errors";
import { getAltLinksCollection } from "@/lib/db/collections";
import { redactEvidenceForRole } from "../../_shared";

interface RouteParams {
  params: Promise<{ pair: string }>;
}

const HEX_ID = "[0-9a-f]{24}";
const PAIR_RE = new RegExp(`^(${HEX_ID})_(${HEX_ID})$`, "i");

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const auth = await requireModerator();
    if (!auth.ok) return auth.response;

    const { pair } = await params;
    const match = PAIR_RE.exec(pair);
    if (!match) {
      return NextResponse.json({ error: "Invalid pair (expected <idA>_<idB>)" }, { status: 400 });
    }

    // `altLinks` is unique on the sorted `(userA, userB)` pair
    // (`src/lib/altDetection/buildLinks.ts` `sortPair`,
    // `src/lib/admin/seed/indexes/altDetection.ts`) — sort the caller's two
    // ids the same way before the exact-match lookup, so the pair can be
    // requested in either order.
    const [idA, idB] =
      match[1].toLowerCase() <= match[2].toLowerCase()
        ? [match[1], match[2]]
        : [match[2], match[1]];

    const db = await getDb();
    const linksCol = await getAltLinksCollection(db);
    const link = await linksCol.findOne({ userA: new ObjectId(idA), userB: new ObjectId(idB) });
    if (!link) {
      return NextResponse.json({ error: "Link not found" }, { status: 404 });
    }

    const isAdmin = auth.user.isAdmin === true;

    return NextResponse.json({
      userA: link.userA.toString(),
      userB: link.userB.toString(),
      confidence: link.confidence,
      signals: link.signals.map((signal) => ({
        type: signal.type,
        weight: signal.weight,
        contribution: signal.contribution,
        evidence: redactEvidenceForRole(signal.evidence, isAdmin),
      })),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

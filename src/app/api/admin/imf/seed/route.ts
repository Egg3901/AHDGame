// GET /api/admin/imf/seed — Whether the IMF institution corporation exists
// POST /api/admin/imf/seed — Create or repair IMF corp (admin-picked CEO + 2 shareholders)
// Auth: requireAdmin
// Errors: 400, 401, 403

import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import { parseJsonBody, schemas } from "@/lib/api/validate";
import { getImfCorporation } from "@/lib/imf/resolveImfCorporation";
import { SeedImfInstitutionError, seedImfInstitution } from "@/lib/imf/seedImfInstitution";

const postSchema = z
  .object({
    ceoCharacterId: schemas.objectId,
    shareholderCharacterIds: z.tuple([schemas.objectId, schemas.objectId]),
    repair: z.boolean().optional(),
  })
  .refine((data) => data.shareholderCharacterIds[0] !== data.shareholderCharacterIds[1], {
    message: "The two shareholders must be different characters",
    path: ["shareholderCharacterIds"],
  })
  .refine(
    (data) =>
      data.ceoCharacterId === data.shareholderCharacterIds[0] ||
      data.ceoCharacterId === data.shareholderCharacterIds[1],
    {
      message: "CEO must be one of the two starting shareholders",
      path: ["ceoCharacterId"],
    }
  );

export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const imf = await getImfCorporation(db);
    return NextResponse.json({
      seeded: !!imf,
      corporationId: imf?._id.toString(),
      sequentialId: imf?.sequentialId ?? null,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, postSchema);
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });

    const db = await getDb();
    const result = await seedImfInstitution(db, {
      ceoCharacterId: new ObjectId(parsed.data.ceoCharacterId),
      shareholderCharacterIds: [
        new ObjectId(parsed.data.shareholderCharacterIds[0]),
        new ObjectId(parsed.data.shareholderCharacterIds[1]),
      ],
      repairExisting: parsed.data.repair !== false,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    if (error instanceof SeedImfInstitutionError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return handleRouteError(error);
  }
}

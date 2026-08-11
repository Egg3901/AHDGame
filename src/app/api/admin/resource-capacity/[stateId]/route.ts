// PATCH — update resource capacity for a state (admin only)

import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { z } from "zod";
import { EXTRACTABLE_RESOURCES } from "@/lib/constants/commodities";
import type { StateResourceCapacity } from "@/lib/db/types/stateResourceCapacity";

const schema = z.object({
  resources: z.record(z.enum(EXTRACTABLE_RESOURCES), z.number().min(0)),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ stateId: string }> }
) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { stateId } = await params;
    const parsed = await parseJsonBody(request, schema);
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });

    const db = await getDb();
    await db
      .collection<StateResourceCapacity>("stateResourceCapacity")
      .updateOne(
        { stateId },
        { $set: { resources: parsed.data.resources, updatedAt: new Date() } },
        { upsert: true }
      );

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}

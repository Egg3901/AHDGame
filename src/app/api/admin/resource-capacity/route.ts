// GET — list all stateResourceCapacity documents

import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import type { StateResourceCapacity } from "@/lib/db/types/stateResourceCapacity";

export async function GET(_request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const docs = await db
      .collection<StateResourceCapacity>("stateResourceCapacity")
      .find({})
      .sort({ stateId: 1 })
      .toArray();

    return NextResponse.json({
      capacities: docs.map((d) => ({
        ...d,
        _id: d._id.toString(),
      })),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

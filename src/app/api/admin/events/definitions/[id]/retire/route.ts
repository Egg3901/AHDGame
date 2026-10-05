import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError, notFound, errorResponse } from "@/lib/api/errors";
import { getEventDefinitionsCollection } from "@/lib/db/collections/eventDefinitions";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { id } = await params;
    if (!ObjectId.isValid(id)) {
      return errorResponse(400, "Invalid definition id");
    }

    const db = await getDb();
    const coll = getEventDefinitionsCollection(db);
    const updated = await coll.findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: { status: "retired", updatedAt: new Date() } },
      { returnDocument: "after" }
    );

    if (!updated) {
      return NextResponse.json(notFound("Event definition").toJson(), { status: 404 });
    }

    return NextResponse.json({ definition: updated });
  } catch (error) {
    return handleRouteError(error);
  }
}

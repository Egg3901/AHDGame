import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError, notFound } from "@/lib/api/errors";
import { getEventDefinitionsCollection } from "@/lib/db/collections/eventDefinitions";
import { getEventHandler } from "@/lib/events/substrate/registry";
import "@/lib/events/pree/index";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { id } = await params;
    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid definition id" }, { status: 400 });
    }

    const db = await getDb();
    const coll = getEventDefinitionsCollection(db);
    const existing = await coll.findOne({ _id: new ObjectId(id) });
    if (!existing) {
      return NextResponse.json(notFound("Event definition").toJson(), { status: 404 });
    }

    const handler = getEventHandler(existing.kind);
    if (!handler) {
      return NextResponse.json(
        { error: `No code-first handler registered for kind ${existing.kind}` },
        { status: 400 }
      );
    }

    // The handler owns option ids and the default; the definition supplies
    // display copy. Approving a drifted definition would render buttons whose
    // ids the resolve route rejects — block it here.
    const handlerOptionIds = new Set(handler.options.map((o) => o.id));
    const definitionOptionIds = new Set(existing.options.map((o) => o.id));
    const mismatched =
      handler.defaultOptionId !== existing.defaultOptionId ||
      handlerOptionIds.size !== definitionOptionIds.size ||
      [...handlerOptionIds].some((id) => !definitionOptionIds.has(id));
    if (mismatched) {
      return NextResponse.json(
        {
          error: `Definition options for ${existing.kind} do not match the registered handler (handler: ${[...handlerOptionIds].join(", ")} / default ${handler.defaultOptionId}; definition: ${[...definitionOptionIds].join(", ")} / default ${existing.defaultOptionId}). Re-seed to sync.`,
        },
        { status: 400 }
      );
    }

    const now = new Date();
    const updated = await coll.findOneAndUpdate(
      { _id: existing._id },
      {
        $set: {
          status: "approved",
          approvedBy: new ObjectId(auth.admin.userId),
          approvedAt: now,
          updatedAt: now,
        },
      },
      { returnDocument: "after" }
    );

    return NextResponse.json({ definition: updated });
  } catch (error) {
    return handleRouteError(error);
  }
}

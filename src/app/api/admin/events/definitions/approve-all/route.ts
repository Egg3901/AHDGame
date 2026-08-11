import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { getEventDefinitionsCollection } from "@/lib/db/collections/eventDefinitions";
import { getEventHandler } from "@/lib/events/substrate/registry";
import "@/lib/events/pree/index";

/**
 * Bulk-approve every draft definition whose options match a registered
 * handler. Definitions that have no handler, or whose option ids/default
 * drifted from the handler, are skipped and reported — approving them would
 * render buttons the resolve route rejects.
 */
export async function POST() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const coll = getEventDefinitionsCollection(db);
    const drafts = await coll.find({ status: "draft" }).toArray();

    const now = new Date();
    const approvedBy = new ObjectId(auth.admin.userId);
    let approved = 0;
    const skipped: { kind: string; reason: string }[] = [];

    for (const def of drafts) {
      const handler = getEventHandler(def.kind);
      if (!handler) {
        skipped.push({ kind: def.kind, reason: "no registered handler" });
        continue;
      }
      const handlerIds = new Set(handler.options.map((o) => o.id));
      const defIds = new Set(def.options.map((o) => o.id));
      const mismatched =
        handler.defaultOptionId !== def.defaultOptionId ||
        handlerIds.size !== defIds.size ||
        [...handlerIds].some((id) => !defIds.has(id));
      if (mismatched) {
        skipped.push({ kind: def.kind, reason: "options drifted from handler — re-seed" });
        continue;
      }

      await coll.updateOne(
        { _id: def._id },
        { $set: { status: "approved", approvedBy, approvedAt: now, updatedAt: now } }
      );
      approved += 1;
    }

    return NextResponse.json({ approved, skipped, totalDrafts: drafts.length });
  } catch (error) {
    return handleRouteError(error);
  }
}

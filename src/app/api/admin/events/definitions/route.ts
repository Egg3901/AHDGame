import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { getEventDefinitionsCollection } from "@/lib/db/collections/eventDefinitions";
import type { EventDefinition } from "@/lib/db/types/events";
import { getEventHandler } from "@/lib/events/substrate/registry";
import "@/lib/events/pree/index";

const createSchema = z.object({
  kind: z.string().min(1),
  title: z.string().min(1),
  headline: z.string().min(1),
  body: z.string().min(1),
  eligibility: z.array(z.enum(["all", "politician", "ceo", "inElection"])).min(1),
  baseWeight: z.number().positive(),
  defaultOptionId: z.string().min(1),
  options: z
    .array(
      z.object({
        id: z.string().min(1),
        label: z.string().min(1),
        description: z.string().min(1),
        isDefault: z.boolean().optional(),
      })
    )
    .min(1),
});

export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const definitions = await getEventDefinitionsCollection(db)
      .find({})
      .sort({ kind: 1 })
      .toArray();

    // Enrich each option with its handler's outcome table so the admin panel
    // can show every possible outcome (roll band + effects) inline. Outcomes
    // are owned by the code handler, not the DB document.
    const enriched = definitions.map((def) => {
      const handler = getEventHandler(def.kind);
      const outcomesByOption = new Map((handler?.options ?? []).map((o) => [o.id, o.outcomeTable]));
      return {
        ...def,
        options: def.options.map((o) => ({
          ...o,
          outcomes: outcomesByOption.get(o.id) ?? null,
        })),
      };
    });

    return NextResponse.json({ definitions: enriched });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, createSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();
    const coll = getEventDefinitionsCollection(db);
    const existing = await coll.findOne({ kind: parsed.data.kind });
    if (existing) {
      return NextResponse.json({ error: "Definition kind already exists" }, { status: 409 });
    }

    const now = new Date();
    const doc: EventDefinition = {
      _id: new ObjectId(),
      kind: parsed.data.kind,
      status: "draft",
      version: 1,
      title: parsed.data.title,
      headline: parsed.data.headline,
      body: parsed.data.body,
      eligibility: parsed.data.eligibility,
      baseWeight: parsed.data.baseWeight,
      cooldownTurnsMin: 0,
      cooldownTurnsMax: 0,
      options: parsed.data.options,
      defaultOptionId: parsed.data.defaultOptionId,
      createdAt: now,
      updatedAt: now,
    };

    await coll.insertOne(doc);
    return NextResponse.json({ definition: doc }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}

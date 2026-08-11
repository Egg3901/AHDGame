// PUT /api/country/[code]/executive/cabinet/[positionId]/commands
// Save the per-country military command structure. Auth: defense holder or admin.
// Gated by conflictsEnabled + defense seat. Client-authoritative (commands grant no
// resources) with light server validation. Errors: 400, 401, 403, 404.
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getCabinetMembersCollection } from "@/lib/db/collections/cabinetMembers";
import { getGameStateCollection } from "@/lib/db/collections/gameState";
import { getMilitaryUnitsCollection } from "@/lib/db/collections/militaryUnits";
import { getMilitaryCommandsCollection } from "@/lib/db/collections/militaryCommands";
import { DEFENSE_POSITION_BY_COUNTRY } from "@/lib/constants/military";
import { STRATEGIC_REGIONS } from "@/lib/military/regions";
import { listCountryGenerals } from "@/lib/db/collections/characterGenerals";
import type { MilitaryCommand } from "@/lib/military/types";
import type { Character } from "@/lib/db/types";
import { createNotifications, type NotificationInput } from "@/lib/notifications";

// Light shape validation — the command org is client-authoritative (no resources spent);
// the server guards ownership + referential integrity below.
const commandSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  commanderIds: z.array(z.string()),
  commandingGeneralId: z.string().nullable(),
  regionIds: z.array(z.string()),
  spec: z.string(),
  posture: z.string(),
  supply: z.string(),
  readiness: z.string(),
  cap: z.number(),
  base: z.number(),
  political: z.string(),
  branchFocus: z.string(),
  unitIds: z.array(z.string()),
  role: z.string(),
});
const bodySchema = z.object({
  // Ids must be unique: every client action keys on `commandId` through a `.map`, so
  // two commands sharing an id are edited together, render as one selection, and open
  // the wrong detail panel. Client ids used to come from a counter that reset each
  // page load, which produced exactly that. Refused here so the corrupt shape cannot
  // reach the database again.
  commands: z.array(commandSchema).refine((cs) => new Set(cs.map((c) => c.id)).size === cs.length, {
    message: "Duplicate command id",
  }),
});

interface RouteParams {
  params: Promise<{ code: string; positionId: string }>;
}

export async function PUT(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const { code, positionId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country" }, { status: 400 });
    }
    if (DEFENSE_POSITION_BY_COUNTRY[countryId] !== positionId) {
      return NextResponse.json(
        { error: "Commands are managed from the defence minister’s office." },
        { status: 404 }
      );
    }

    const parsed = await parseJsonBody(request, bodySchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();
    const gsCol = await getGameStateCollection(db);
    const gs = await gsCol.findOne({ _id: "current" }, { projection: { conflictsEnabled: 1 } });
    if (!gs?.conflictsEnabled) {
      return NextResponse.json({ error: "Conflicts subsystem disabled" }, { status: 404 });
    }

    const member = await getCabinetMembersCollection(db).findOne({ countryId, positionId });
    const isHolder =
      member?.characterId &&
      auth.user.character &&
      member.characterId.toString() === auth.user.character._id.toString();
    if (!isHolder && !auth.user.isAdmin) {
      return NextResponse.json(
        { error: "Only the defence minister may edit commands." },
        { status: 403 }
      );
    }

    // Referential integrity.
    const { commands } = parsed.data;
    const validRegions = new Set<string>(STRATEGIC_REGIONS.map((r) => r.id));
    // Commanders are the country's commissioned generals (character ids).
    const validCommanders = new Set((await listCountryGenerals(db, countryId)).map((g) => g.id));
    const ownUnits = new Set(
      (await getMilitaryUnitsCollection(db).find({ countryId }).project({ _id: 1 }).toArray()).map(
        (u) => String(u._id)
      )
    );
    const seenUnit = new Set<string>();
    // One command per Commanding General. The CG's own page resolves their command
    // with `commands.find(c => c.commandingGeneralId === characterId)` — first match
    // only — so a general leading two could operate just one, and the other
    // command's generals could never be posted to a conflict at all. Its units would
    // exist and never reach a front, with nothing reporting why.
    //
    // Sitting on two ROSTERS is fine and stays allowed; only the lead is constrained.
    const seenLead = new Set<string>();
    for (const c of commands) {
      for (const uid of c.unitIds) {
        if (!ownUnits.has(uid)) {
          return NextResponse.json(
            { error: "That command claims a unit that does not belong to this country." },
            { status: 400 }
          );
        }
        if (seenUnit.has(uid)) {
          return NextResponse.json(
            { error: "A unit can belong to only one command. Remove it from the other one first." },
            { status: 400 }
          );
        }
        seenUnit.add(uid);
      }
      if (c.regionIds.some((r) => !validRegions.has(r))) {
        return NextResponse.json(
          { error: "That command claims a region that does not exist." },
          { status: 400 }
        );
      }
      if (c.commanderIds.some((m) => !validCommanders.has(m))) {
        return NextResponse.json(
          {
            error: "That command lists someone who is not a commissioned general of this country.",
          },
          { status: 400 }
        );
      }
      // The lead must be one of this command's own commanders — which the check
      // above has already proven are real commissioned generals of this country.
      if (c.commandingGeneralId !== null && !c.commanderIds.includes(c.commandingGeneralId)) {
        return NextResponse.json(
          {
            error:
              "A commanding general must first be a commander of that command. Add them to it, then promote them.",
          },
          { status: 400 }
        );
      }
      if (c.commandingGeneralId !== null) {
        if (seenLead.has(c.commandingGeneralId)) {
          return NextResponse.json(
            {
              error:
                "A general can lead only one command. Clear their other command’s commanding general first.",
            },
            { status: 400 }
          );
        }
        seenLead.add(c.commandingGeneralId);
      }
    }

    // Read the PREVIOUS commands before overwriting, so a new Commanding General can
    // be told they were appointed. This route is client-authoritative and debounced —
    // it re-sends the whole array on every edit — so notifying on presence rather
    // than on CHANGE would ping the same player on every keystroke.
    const previous =
      (await getMilitaryCommandsCollection(db).findOne({ countryId }))?.commands ?? [];
    const prevLeadOf = new Map(previous.map((c) => [c.id, c.commandingGeneralId ?? null]));
    const newlyAppointed = commands
      .filter((c) => c.commandingGeneralId !== null)
      .filter((c) => prevLeadOf.get(c.id) !== c.commandingGeneralId)
      .map((c) => ({ characterId: c.commandingGeneralId as string, commandName: c.name }));

    await getMilitaryCommandsCollection(db).updateOne(
      { countryId },
      // Zod validates the shape loosely (string enums); referential integrity is
      // checked above. Narrow to the domain type for storage.
      { $set: { commands: commands as unknown as MilitaryCommand[] }, $setOnInsert: { countryId } },
      { upsert: true }
    );

    // Fire-and-forget: createNotifications swallows and logs its own failures, so a
    // notification problem never fails the save the Secretary just made.
    // Character ids are ObjectId strings; anything else cannot name a player, and
    // `new ObjectId(bad)` THROWS — which would fail the save the Secretary just made
    // over a notification. Filtered rather than trusted.
    const notifiable = newlyAppointed.filter((n) => ObjectId.isValid(n.characterId));
    if (notifiable.length > 0) {
      const chars = await db
        .collection<Character>("characters")
        .find({ _id: { $in: notifiable.map((n) => new ObjectId(n.characterId)) } })
        .project<{ _id: ObjectId; userId?: ObjectId }>({ _id: 1, userId: 1 })
        .toArray();
      const userOf = new Map(chars.filter((c) => c.userId).map((c) => [String(c._id), c.userId!]));
      const inputs: NotificationInput[] = notifiable
        .filter((n) => userOf.has(n.characterId))
        .map((n) => ({
          userId: userOf.get(n.characterId)!,
          type: "command_appointed" as const,
          title: "You command a force",
          // Names the page, because that is the whole problem this solves: a new CG
          // otherwise has no route to the one surface where they can act.
          message: `You have been named Commanding General of ${n.commandName}. Post your generals to conflicts from your command page.`,
          metadata: { countryId, href: `/country/${countryId.toLowerCase()}/general/commands` },
        }));
      await createNotifications(inputs);
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleRouteError(error);
  }
}

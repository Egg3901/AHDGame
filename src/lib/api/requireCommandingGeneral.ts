import { NextResponse } from "next/server";
import type { Db } from "mongodb";
import { forbidden } from "@/lib/api/errors";
import type { CountryId } from "@/lib/constants/countries";
import type { CommanderRef, MilitaryCommand } from "@/lib/military/types";
import { getMilitaryCommands } from "@/lib/db/collections/militaryCommands";
import { listCountryGenerals } from "@/lib/db/collections/characterGenerals";

export type CommandingGeneralResult =
  | {
      ok: true;
      command: MilitaryCommand;
      /**
       * The country's commissioned generals, already loaded to authorize the
       * caller. Handed back so the route validating what they submitted uses the
       * SAME roster this authorization used, and reads it once.
       */
      roster: CommanderRef[];
    }
  | { ok: false; response: NextResponse };

/**
 * Authorize the caller as the Commanding General of a Command in `countryId`, and
 * resolve the Command they lead.
 *
 * Authority here comes from *being* `commandingGeneralId` on a Command — not from
 * holding a cabinet seat. This is the split-authority model: the defense holder owns
 * force structure and appoints the CG; the CG owns employment (posting their own
 * generals to Conflicts). Being merely a member of a Command grants nothing.
 *
 * Country-scoped by construction: commands are stored per country, so leading a
 * Command elsewhere confers no authority here.
 *
 * But the reverse is NOT automatic. `commandingGeneralId` is a character id, and a
 * character can emigrate or be dismissed as a general without anything touching the
 * saved command — live data had Russia's only command led by a general who had moved
 * to the United Kingdom, which left a foreign player able to post Russia's generals
 * and name its Theater Commanders. So the lead is re-checked against the country's
 * commissioned generals, not merely against the stored id.
 *
 * Returns a 403 response on failure so routes can `if (!r.ok) return r.response`.
 */
export async function requireCommandingGeneral(
  db: Db,
  countryId: CountryId,
  actorCharacterId: string | null
): Promise<CommandingGeneralResult> {
  const deny = () => ({
    ok: false as const,
    response: NextResponse.json(
      forbidden("Only a commanding general may perform this action.").toJson(),
      { status: 403 }
    ),
  });

  if (!actorCharacterId) return deny();

  const commands = await getMilitaryCommands(db, countryId);
  const command = commands.find((c) => c.commandingGeneralId === actorCharacterId);
  if (!command) return deny();

  // Only on the otherwise-authorized path, so an unauthorized caller costs nothing.
  const roster = await listCountryGenerals(db, countryId);
  if (!roster.some((g) => g.id === actorCharacterId)) return deny();

  return { ok: true, command, roster };
}

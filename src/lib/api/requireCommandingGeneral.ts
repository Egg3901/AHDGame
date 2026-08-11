import { NextResponse } from "next/server";
import type { Db } from "mongodb";
import { forbidden } from "@/lib/api/errors";
import type { CountryId } from "@/lib/constants/countries";
import type { MilitaryCommand } from "@/lib/military/types";
import { getMilitaryCommands } from "@/lib/db/collections/militaryCommands";

export type CommandingGeneralResult =
  { ok: true; command: MilitaryCommand } | { ok: false; response: NextResponse };

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
  return command ? { ok: true, command } : deny();
}

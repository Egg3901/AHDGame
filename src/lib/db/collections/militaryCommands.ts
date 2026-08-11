import type { Db } from "mongodb";
import type { MilitaryCommandsDoc } from "@/lib/db/types/militaryCommands";
import type { MilitaryCommand } from "@/lib/military/types";
import type { CountryId } from "@/lib/constants/countries";

export function getMilitaryCommandsCollection(db: Db) {
  return db.collection<MilitaryCommandsDoc>("militaryCommands");
}

/** The stored per-country commands, or [] when none exists (upserted on first save). */
export async function getMilitaryCommands(db: Db, countryId: string): Promise<MilitaryCommand[]> {
  const doc = await getMilitaryCommandsCollection(db).findOne({
    countryId: countryId as CountryId,
  });
  // Back-compat: commands stored before commandingGeneralId existed default their
  // lead to the first commander — the convention the roster used to render
  // implicitly. Without this the client would echo `undefined` back to the PUT,
  // whose schema requires the field, and every save would 400.
  //
  // Only an *absent* field defaults. An explicit null means the lead was
  // deliberately cleared, and `??` would resurrect it on every load.
  //
  // A general may lead only ONE command (the CG's page resolves theirs by first
  // match). Enforced on write by the commands PUT — but two sources can hand us a
  // duplicate the Secretary never chose:
  //   - the back-compat default above, when two legacy commands share a first
  //     commander, and
  //   - data saved before that rule existed.
  // Either way the client would echo the duplicate back and every save would 400,
  // leaving the Secretary unable to change anything. Later claims are dropped here
  // so the state that loads is always a state that can be saved.
  const seenLead = new Set<string>();
  return (doc?.commands ?? []).map((c) => {
    const derived =
      c.commandingGeneralId === undefined ? (c.commanderIds[0] ?? null) : c.commandingGeneralId;
    if (derived === null) return { ...c, commandingGeneralId: null };
    if (seenLead.has(derived)) return { ...c, commandingGeneralId: null };
    seenLead.add(derived);
    return { ...c, commandingGeneralId: derived };
  });
}

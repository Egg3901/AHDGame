import type { Db, ObjectId } from "mongodb";
import type { NPP } from "@/lib/db/types";
import { generateUniqueNPPNameAndGender, isNameFromCountryPool } from "./nameGenerator";
import { selectPoliticianImage, weightedRandomEthnicity } from "./generator";
import type { CountryId } from "@/lib/constants/countries";
import { syncDenormalizedNppName } from "./syncDenormalizedName";

/**
 * Rename NPPs that were seeded from the wrong name pool.
 *
 * Countries without a generator of their own fell back to the US pool, so the
 * Italian chamber seeded deputies called "Carmen Washington" and the Duma
 * seeded "Christopher Polk Sr.". Adding the pools fixes every NPP generated
 * from now on; the ones already in the database need this.
 *
 * Renaming is deliberately an admin-triggered heal rather than a migration
 * that runs on deploy: it changes names players may already have seen, and
 * that is a call for whoever runs the world, not for a boot script.
 */

/** One NPP the heal would rename, with the name it would be given. */
export interface NppRename {
  nppId: ObjectId;
  countryId: string;
  oldName: string;
  newName: string;
  gender: "male" | "female";
  avatarUrl?: string;
}

type HealCandidate = Pick<
  NPP,
  "_id" | "name" | "countryId" | "gender" | "ethnicity" | "avatarUrl" | "isTechnocrat"
>;

/**
 * Find every active NPP whose name could not have come from its own country's
 * pool. Names are reserved across the whole set as it goes, so the renames it
 * proposes do not collide with each other or with names already in use.
 */
export async function planNppNameHeal(
  db: Db,
  options: { countryId?: string; limit?: number } = {}
): Promise<{ scanned: number; renames: NppRename[]; unresolved: number }> {
  const query: Record<string, unknown> = { retiredAt: null };
  if (options.countryId) query.countryId = options.countryId;

  const npps = await db
    .collection<NPP>("npps")
    .find(query)
    .project<HealCandidate>({
      name: 1,
      countryId: 1,
      gender: 1,
      ethnicity: 1,
      avatarUrl: 1,
      isTechnocrat: 1,
    })
    .toArray();

  // Reserve every existing name up front — a rename must not land on a name
  // another NPP already holds, including ones this heal is not touching.
  const takenNames = npps.map((npp) => npp.name);
  const renames: NppRename[] = [];
  let unresolved = 0;

  for (const npp of npps) {
    const countryId = npp.countryId;
    if (!countryId) continue;
    // Technocrats (autonomous central-bank chairs) are named from
    // `pickTechnocratName`'s deliberately international pool — "Iris Marchetti",
    // "Reginald Finch". That pool is a design choice, not the silent US
    // fallback this heal exists to undo, so they are left alone.
    if (npp.isTechnocrat) continue;
    if (isNameFromCountryPool(npp.name, countryId)) continue;

    const generated = generateUniqueNPPNameAndGender(takenNames, 200, countryId);
    if (!generated) {
      // The pool could not produce a name unused by this world. Leave the NPP
      // alone rather than assigning a duplicate.
      unresolved++;
      continue;
    }
    takenNames.push(generated.name);

    const ethnicity = npp.ethnicity ?? weightedRandomEthnicity(countryId as CountryId);
    const avatarUrl = selectPoliticianImage(
      countryId as CountryId,
      generated.gender,
      ethnicity,
      generated.name
    );

    renames.push({
      nppId: npp._id,
      countryId,
      oldName: npp.name,
      newName: generated.name,
      gender: generated.gender,
      ...(avatarUrl ? { avatarUrl } : {}),
    });

    if (options.limit && renames.length >= options.limit) break;
  }

  return { scanned: npps.length, renames, unresolved };
}

/**
 * Apply a plan. The NPP's gender is rewritten alongside the name because the
 * two are generated together — leaving a stale gender behind is how a "Sylvie"
 * ends up with a man's portrait.
 */
export async function applyNppNameHeal(
  db: Db,
  renames: NppRename[]
): Promise<{ renamed: number; officialsUpdated: number; candidaciesUpdated: number }> {
  let renamed = 0;
  let officialsUpdated = 0;
  let candidaciesUpdated = 0;

  for (const rename of renames) {
    await db.collection<NPP>("npps").updateOne(
      { _id: rename.nppId },
      {
        $set: {
          name: rename.newName,
          gender: rename.gender,
          ...(rename.avatarUrl ? { avatarUrl: rename.avatarUrl } : {}),
          updatedAt: new Date(),
        },
      }
    );
    renamed++;

    // electionCandidates + electedOfficials both snapshot characterName.
    const synced = await syncDenormalizedNppName(db, rename.nppId, rename.newName);
    officialsUpdated += synced.officialsUpdated;
    candidaciesUpdated += synced.candidaciesUpdated;
  }

  return { renamed, officialsUpdated, candidaciesUpdated };
}

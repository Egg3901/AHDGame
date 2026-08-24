import { ObjectId, type Db } from "mongodb";
import {
  getCountryConfig,
  getExecutiveOfficeKey,
  getHeadOfStateOfficeType,
  getHeadOfStateTitle,
  isImperialCountry,
  type CountryId,
} from "@/lib/constants/countries";
import { getHeadOfGovernmentCharacterId } from "@/lib/api/headOfGovernment";
import type { ElectedOfficial } from "@/lib/db/types/officials";

/** Why a viewer may see a cabinet office. Null when they may not. */
export type CabinetOfficeViewerRole = "holder" | "headOfGovernment" | "headOfState" | "admin";

export interface CabinetOfficeVisibility {
  /** May the viewer read this office's records at all? */
  canView: boolean;
  /** May the viewer use this office's levers? Unchanged meaning: holder or admin. */
  canAct: boolean;
  viewerRole: CabinetOfficeViewerRole | null;
}

const HIDDEN: CabinetOfficeVisibility = { canView: false, canAct: false, viewerRole: null };

/** The world's active seed preset, which decides what a country's offices are. */
async function readActivePreset(db: Db): Promise<string | undefined> {
  const gameState = await db
    .collection<{ _id: string; preset?: string }>("gameState")
    .findOne({ _id: "current" }, { projection: { preset: 1 } });
  return gameState?.preset;
}

/**
 * Who may look inside a cabinet office.
 *
 * A cabinet office's records are the department's own: the force it fields, the
 * money it holds, the orders it has standing. Before this gate every one of
 * those numbers was served to anybody who knew the URL, including foreign
 * governments reading an opponent's order of battle off the defence page.
 *
 * The rule is deliberately narrow. Only the seated officeholder, and the two
 * offices that sit above every seat in the same country's government, may see
 * inside. Cabinet colleagues cannot: a foreign ministry has no business in the
 * defence ledger. Country scoping is implicit, because every head-of-X lookup
 * here is asked about the OFFICE's country, so a foreign head of government
 * never matches.
 *
 * A head of state is reached three ways, because the game models them three
 * ways: elected into `electedOfficials` (Ireland, France), appointed or synced
 * into the same collection (RU's presidium chairman, CN's party chair), or
 * reigning on the imperial roll with no office at all (the UK, Japan).
 *
 * `canAct` keeps exactly the meaning it had before (holder or admin), so a head
 * of government reads their own cabinet without being able to pull its levers.
 *
 * This is the single seam for widening visibility later. Intelligence
 * investment, counterintelligence, and allied information sharing all belong
 * here as additional ways to earn a `viewerRole`, not as new checks scattered
 * across the routes.
 *
 * @param holderCharacterId The seat's current holder; null for a vacant or
 *   NPP-held seat. Passed in rather than re-read because every caller has
 *   already loaded the cabinet member.
 * @param preset The active seed preset. Optional: read from the world when a
 *   caller does not already have it, so nobody can get this wrong by omission.
 *   It matters because presets redefine `officeTypes` — Spain's head of state is
 *   the `monarch` canonically but the `caudillo` under 1953-default, and reading
 *   the wrong one locks the real head of state out of their own cabinet.
 */
export async function resolveCabinetOfficeVisibility(
  db: Db,
  args: {
    countryId: CountryId;
    holderCharacterId: ObjectId | null;
    viewerCharacterId: ObjectId | null;
    /** The viewer's user id. Required to recognise a crowned head of state. */
    viewerUserId?: string | null;
    isAdmin: boolean;
    preset?: string;
  }
): Promise<CabinetOfficeVisibility> {
  const { countryId, holderCharacterId, viewerCharacterId, viewerUserId, isAdmin } = args;

  // Compared as strings, and only when both sides exist: a vacant seat holds a
  // null characterId, and a signed-out visitor has none either. `null === null`
  // would hand every locked office to logged-out traffic.
  const viewerId = viewerCharacterId?.toString() ?? null;

  if (viewerId && holderCharacterId && holderCharacterId.toString() === viewerId) {
    return { canView: true, canAct: true, viewerRole: "holder" };
  }

  // Admins are checked after the holder so an admin who actually holds the seat
  // reports as its holder, which is the truthful role for audit copy.
  if (isAdmin) {
    return { canView: true, canAct: true, viewerRole: "admin" };
  }

  // Neither identity means a signed-out visitor. Not `!viewerId` alone: a player
  // reigning as an imperial character need not have an ordinary character at all,
  // and bailing here would shut the monarch out before the crown is ever checked.
  if (!viewerId && !viewerUserId) return HIDDEN;

  if (viewerId) {
    const hogCharacterId = await getHeadOfGovernmentCharacterId(db, countryId);
    if (hogCharacterId && hogCharacterId.toString() === viewerId) {
      return { canView: true, canAct: false, viewerRole: "headOfGovernment" };
    }
  }

  // Resolved lazily on purpose: only this branch needs the preset, and it is
  // reached only after holder, admin and head of government have all missed, so
  // the common paths never pay for the lookup.
  const preset = args.preset ?? (await readActivePreset(db));
  const config = getCountryConfig(countryId, preset);
  const headOfStateOfficeType = getHeadOfStateOfficeType(config);
  if (viewerId && headOfStateOfficeType) {
    const hos = await db
      .collection<ElectedOfficial>("electedOfficials")
      .findOne(
        { countryId, officeType: headOfStateOfficeType, characterId: { $ne: null } },
        { projection: { characterId: 1 } }
      );
    if (hos?.characterId && hos.characterId.toString() === viewerId) {
      return { canView: true, canAct: false, viewerRole: "headOfState" };
    }
  }

  // A crowned head of state is not an elected official and is not in the
  // `characters` collection at all — they are an imperial character, keyed by
  // USER rather than by character. Nothing ever writes a monarch into
  // `electedOfficials` (only RU's presidium chairman and CN's party-chair sync
  // write those rows), so without this branch every monarch and emperor would be
  // shut out of their own government: the UK and Japan have no isHeadOfState
  // office at all, and Spain's and Sweden's sit permanently vacant.
  if (viewerUserId && isImperialCountry(config)) {
    // A country may borrow another's crown, in which case the imperial character
    // is filed under the source country.
    const crownCountryId = config.imperialSharedWith ?? countryId;
    const monarch = await db
      .collection<{ userId: ObjectId; countryId: CountryId }>("imperialCharacters")
      .findOne(
        { countryId: crownCountryId, userId: new ObjectId(viewerUserId) },
        { projection: { _id: 1 } }
      );
    if (monarch) return { canView: true, canAct: false, viewerRole: "headOfState" };
  }

  return HIDDEN;
}

/**
 * The office titles, beyond the seat itself, that may view a cabinet office.
 *
 * Bare labels with no country attached, so the notice can name the country once
 * ("the Taoiseach and Uachtarán of Ireland") instead of once per title. Head of
 * government first, then the ceremonial head of state where that is a separate
 * seat. Countries whose executive fuses both roles (the US president) or whose
 * head of state is an unplayable monarch (the UK) return a single title.
 */
export function cabinetOfficeViewerTitles(countryId: CountryId, preset?: string): string[] {
  const config = getCountryConfig(countryId, preset);
  const titles: string[] = [];

  const executiveKey = getExecutiveOfficeKey(countryId, preset);
  const executive = config.officeTypes.find((office) => office.key === executiveKey);
  if (executive) titles.push(executive.label);

  const headOfStateKey = getHeadOfStateOfficeType(config);
  if (headOfStateKey && headOfStateKey !== executiveKey) {
    const headOfState = config.officeTypes.find((office) => office.key === headOfStateKey);
    if (headOfState) titles.push(headOfState.label);
  } else if (!headOfStateKey && isImperialCountry(config)) {
    // A crown that holds no officeType (the UK monarch, the Japanese emperor)
    // still passes the gate via the imperial roll, so the notice has to name it
    // or the copy contradicts the rule. Spain and Sweden take the branch above
    // instead, which is why this one only fires when there is no office at all.
    titles.push(getHeadOfStateTitle(config));
  }

  return titles;
}

/**
 * How to name a country after an office title: "President of <realm>".
 *
 * `executiveRealmPhrase` is the existing field for this and already carries the
 * definite article where the name needs one ("the United States"), which the
 * bare `name` does not. Same fallback as the executive-label renderer in
 * `utils/politics.ts`.
 */
export function cabinetOfficeRealmPhrase(countryId: CountryId, preset?: string): string {
  const config = getCountryConfig(countryId, preset);
  return config.executiveRealmPhrase ?? config.name;
}

import type { Db, ObjectId } from "mongodb";
import {
  getCountryConfig,
  getExecutiveOfficeKey,
  getHeadOfStateOfficeType,
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
 * defence ledger. Country scoping is implicit, because both head-of-X lookups
 * are asked about the OFFICE's country, so a foreign head of government never
 * matches.
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
    isAdmin: boolean;
    preset?: string;
  }
): Promise<CabinetOfficeVisibility> {
  const { countryId, holderCharacterId, viewerCharacterId, isAdmin } = args;

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

  if (!viewerId) return HIDDEN;

  const hogCharacterId = await getHeadOfGovernmentCharacterId(db, countryId);
  if (hogCharacterId && hogCharacterId.toString() === viewerId) {
    return { canView: true, canAct: false, viewerRole: "headOfGovernment" };
  }

  // Resolved lazily on purpose: only this branch needs the preset, and it is
  // reached only after holder, admin and head of government have all missed, so
  // the common paths never pay for the lookup.
  const preset = args.preset ?? (await readActivePreset(db));
  const headOfStateOfficeType = getHeadOfStateOfficeType(getCountryConfig(countryId, preset));
  if (headOfStateOfficeType) {
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

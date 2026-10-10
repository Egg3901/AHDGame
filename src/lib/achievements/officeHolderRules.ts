/**
 * Rules for the office-holder achievements (cabinet seat, central bank chair).
 * Pure: ids in, grants out. The shell in `officeHolders.ts` loads holders,
 * calls this, and writes the awards.
 */

export interface OfficeHolderCandidate {
  characterId: string;
  userId: string;
}

export interface OfficeHolderGrant {
  slug: "cabinet_seat" | "central_banker";
  userId: string;
  characterId: string;
}

/**
 * Every account with a character that currently holds a cabinet seat (acting or
 * confirmed, any country) or chairs a central bank earns the matching
 * achievement. Achievements are account-bound, so one grant per account per slug.
 */
export function resolveOfficeHolderGrants(input: {
  cabinetCharacterIds: ReadonlySet<string>;
  chairCharacterIds: ReadonlySet<string>;
  characters: readonly OfficeHolderCandidate[];
}): OfficeHolderGrant[] {
  const grants: OfficeHolderGrant[] = [];
  const seen = new Set<string>();
  const push = (slug: OfficeHolderGrant["slug"], c: OfficeHolderCandidate) => {
    const key = `${slug}:${c.userId}`;
    if (seen.has(key)) return;
    seen.add(key);
    grants.push({ slug, userId: c.userId, characterId: c.characterId });
  };
  for (const c of input.characters) {
    if (input.cabinetCharacterIds.has(c.characterId)) push("cabinet_seat", c);
    if (input.chairCharacterIds.has(c.characterId)) push("central_banker", c);
  }
  return grants;
}

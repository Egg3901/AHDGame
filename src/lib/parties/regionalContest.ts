/**
 * Regional parties that only contest their home nation / region.
 *
 * SNP does not stand in England, Plaid Cymru does not stand in Scotland, and
 * the NI parties (DUP / Sinn Fein / UUP) do not stand on the mainland. Seed
 * already omits their statePartyOrg rows outside those homes; this module is
 * the runtime gate so a stale org row, an SNP NPP homed in London, or a
 * player filing cannot put them on a foreign ballot.
 *
 * Ticket #1110: SNP was leading the London Commons race.
 */

export const UK_REGIONAL_PARTY_HOMES_BY_ABBR: Record<string, ReadonlySet<string>> = {
  SNP: new Set(["SCO"]),
  PC: new Set(["WAL"]),
  DUP: new Set(["NIR"]),
  SF: new Set(["NIR"]),
  UUP: new Set(["NIR"]),
};

/** Seed / polling slugs for the same parties, used when abbreviation is not in hand. */
export const UK_REGIONAL_PARTY_SLUG_TO_ABBR: Record<string, string> = {
  uk_snp: "SNP",
  uk_plaid: "PC",
  uk_dup: "DUP",
  uk_sf: "SF",
  uk_uup: "UUP",
};

export const UK_REGIONAL_PARTY_SLUGS: readonly string[] = Object.keys(
  UK_REGIONAL_PARTY_SLUG_TO_ABBR
);

export function canPartyContestState(args: {
  countryId?: string | null;
  abbreviation?: string | null;
  slug?: string | null;
  stateId?: string | null;
}): boolean {
  if (!args.countryId || args.countryId !== "UK") return true;
  if (!args.stateId) return true;

  const abbr = (
    args.abbreviation ?? (args.slug ? UK_REGIONAL_PARTY_SLUG_TO_ABBR[args.slug] : undefined)
  )
    ?.trim()
    .toUpperCase();
  if (!abbr) return true;

  const homes = UK_REGIONAL_PARTY_HOMES_BY_ABBR[abbr];
  if (!homes) return true;
  return homes.has(args.stateId.toUpperCase());
}

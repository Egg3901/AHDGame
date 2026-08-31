/**
 * Which cabinet portfolio a minister holds after their country is absorbed.
 *
 * The sibling of `dissolvingOfficeRemap`, and per-pair for the same reason: two
 * states do not share a portfolio vocabulary, and there is no general rule that
 * turns one country's ministries into another's. East Germany seats a
 * `minister_of_defence`, the Federal Republic a `defense_minister`; matching on
 * a name fragment would seat the Minister for Machine Building in whatever the
 * survivor happened to call its industry department.
 *
 * `null` means the portfolio RETIRES with the state that had it. A portfolio
 * absent from the table retires for the same reason `dissolvingOfficeRemap`
 * treats silence as retirement: an unlisted key is an unanswered question, and
 * guessing at it seats a minister in a ministry nobody said they should have.
 *
 * WHY THE ABSORBED SIDE'S CABINET IS THE ONE THAT CARRIES. The merge runs
 * winner-into-shell: the absorbed country is the one that won the settlement, so
 * its government is the government of the unified state. The survivor's own
 * ministers are cleared — leaving them would seat the defeated side's cabinet
 * beside the winner's, in portfolios the winner's ministers were just given.
 */
export type CabinetRemap = Record<string, string | null>;

const REMAPS: Record<string, CabinetRemap> = {
  // East Germany into Germany, the German Question's challenger outcome.
  //
  // The six carried portfolios are the ones both constitutions actually keep.
  // The retirements are not oversights: the Federal Republic runs no separate
  // trade ministries (foreign and internal trade are the economy ministry's
  // business), no Ministry for Machine Building, and no Council of Ministers
  // deputy premiership. `chairman_of_gosplan` is the one non-obvious mapping —
  // the planning chief and the economy minister are the same office in a command
  // economy, which is exactly the pairing `COMMAND_ECONOMY_OFFICES` already uses
  // for a planned Germany.
  "DD>DE": {
    minister_of_foreign_affairs: "foreign_minister",
    minister_of_defence: "defense_minister",
    minister_of_finance: "finance_minister",
    minister_of_internal_affairs: "interior_minister",
    chairman_of_gosplan: "economy_minister",
    minister_of_railways: "transport_minister",
    minister_of_health: "health_minister",
    minister_of_higher_education: "education_minister",

    // No counterpart in the Federal Republic.
    minister_of_foreign_trade: null,
    minister_of_internal_trade: null,
    minister_of_agriculture: null,
    minister_of_machine_building: null,
    minister_of_culture: null,
    gosbank_liaison: null,
    first_deputy_premier: null,
    // The head of government is carried by `governmentFormations.pmCharacterId`,
    // not as a cabinet row. Listed so the intent is explicit rather than falling
    // through to the unlisted-key rule.
    generalSecretary: null,
  },
};

/** The table for a merging pair, or null when this pair has none. */
export function cabinetRemapFor(fromCountryId: string, toCountryId: string): CabinetRemap | null {
  return REMAPS[`${fromCountryId}>${toCountryId}`] ?? null;
}

/**
 * The portfolio a minister takes in the absorbing country, or null to retire it.
 *
 * A pair with no table at all retires every portfolio — the same conservative
 * default `remapOffice` takes, and for the same reason: a merge between two
 * countries nobody has written a mapping for should not invent one.
 */
export function remapCabinetPosition(from: string, to: string, positionId: string): string | null {
  const table = cabinetRemapFor(from, to);
  if (!table) return null;
  return table[positionId] ?? null;
}

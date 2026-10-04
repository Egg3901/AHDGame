/**
 * Historically the SFRY had ceased to exist by 27 April 1992, when Serbia and
 * Montenegro established the Federal Republic of Yugoslavia. With four turns
 * per month, the last April turn opens this game's settlement decision window.
 * It does not itself retire the federation in alternate-history campaigns.
 * https://hudoc.echr.coe.int/app/conversion/pdf/?id=001-107425&library=ECHR
 */
export const YU_SFRY_DISSOLUTION_CALENDAR_TURN = 64;

export function yuDissolutionDue(preset: string | undefined, calendarTurn: number): boolean {
  return preset === "1991-default" && calendarTurn >= YU_SFRY_DISSOLUTION_CALENDAR_TURN;
}

/** Retire federal offices only after a ratified settlement has created successors. */
export function yuPoliticalRetirementAuthorized(
  currentTurn: number,
  mandateSinceTurn: number | undefined,
  settlementAppliedSinceTurn: number | undefined
): boolean {
  const mandate = mandateSinceTurn ?? 0;
  const settlement = settlementAppliedSinceTurn ?? 0;
  return (
    Number.isSafeInteger(currentTurn) &&
    Number.isSafeInteger(mandate) &&
    Number.isSafeInteger(settlement) &&
    mandate > 0 &&
    settlement > 0 &&
    mandate <= currentTurn &&
    settlement <= currentTurn
  );
}

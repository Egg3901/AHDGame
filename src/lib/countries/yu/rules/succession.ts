/**
 * The SFRY had ceased to exist by 27 April 1992, when Serbia and Montenegro
 * established the Federal Republic of Yugoslavia. With four turns per month,
 * the last April turn is the closest calendar boundary to 27 April.
 * https://hudoc.echr.coe.int/app/conversion/pdf/?id=001-107425&library=ECHR
 */
export const YU_SFRY_DISSOLUTION_CALENDAR_TURN = 64;

export function yuDissolutionDue(preset: string | undefined, calendarTurn: number): boolean {
  return preset === "1991-default" && calendarTurn >= YU_SFRY_DISSOLUTION_CALENDAR_TURN;
}

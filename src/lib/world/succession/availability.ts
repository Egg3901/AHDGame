/** Historical pressure opens a proposal window; it never enacts a breakup. */
export const FEDERATION_DECISION_OPEN_YEAR_1991 = {
  RU: 1991,
  YU: 1991,
  CS: 1992,
} as const;

/**
 * The 1991 Yugoslav declarations and Soviet sovereignty crisis were live in
 * 1991. Czechoslovakia's dissolution law was enacted in 1992 for 1993 effect.
 * https://www.slovenija2001.gov.si/10years/path/documents/declaration/
 * https://www.prlib.ru/node/619099
 * https://www.psp.cz/docs/laws/1992/542.html
 */
export function earliestFederationDecisionYear(
  presetId: string,
  sourceEntityId: string
): number | null {
  if (presetId !== "1991-default") return null;
  if (!Object.hasOwn(FEDERATION_DECISION_OPEN_YEAR_1991, sourceEntityId)) return null;
  return FEDERATION_DECISION_OPEN_YEAR_1991[
    sourceEntityId as keyof typeof FEDERATION_DECISION_OPEN_YEAR_1991
  ];
}

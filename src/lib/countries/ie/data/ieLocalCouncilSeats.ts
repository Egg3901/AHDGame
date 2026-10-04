/**
 * Modeled council size for the game's eight Irish planning regions. NIR is
 * activated only if that region joins Ireland later in a campaign.
 */
export const IE_LOCAL_COUNCIL_SEATS: Readonly<Record<string, number>> = {
  DUB: 62,
  KIL: 26,
  COR: 25,
  DON: 21,
  GAL: 19,
  LIM: 18,
  WEX: 17,
  MID: 12,
  NIR: 95,
};

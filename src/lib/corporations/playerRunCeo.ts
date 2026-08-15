/**
 * Mongo filter for a player-held CEO seat.
 *
 * `Corporation.ceoType` defaults to `"character"` in the type docs, but Mongo
 * equality does not treat a missing field as that default. Founding historically
 * omitted `ceoType` (ticket 1056); those corps still have a human CEO and must
 * remain selectable for deals / supply agreements (ticket 1105). NPP and
 * imperial seats are excluded because they have no player who can accept.
 */
export const PLAYER_RUN_CEO_FILTER = {
  $or: [{ ceoType: "character" as const }, { ceoType: { $exists: false } }],
};

/**
 * Stranded-plant thresholds (supply-dislocation remediation, phase 2).
 *
 * A plant is STRANDED when it chronically cannot sell what it makes: built in
 * a state whose reachable market is glutted for its outputs, it keeps its
 * margin on the units that do clear while most of its output evaporates. One
 * turn of soldFraction is noise; `lowFillTurns` (maintained in sectorTurn) is
 * the chronic signal every consumer here keys on.
 *
 * Three consumers, three thresholds:
 * - WARN: the sector page shows the player a stranded-plant warning with the
 *   downsize/liquidate options. Early, so a player can act before the AI would.
 * - DIVEST: an NPP corp exits the plant entirely (capacity is deliberately NOT
 *   returned to the unowned pool — restoring it would invite the next founding
 *   straight back into the same glut).
 * - The divest bar is deliberately double the warn bar: an NPP gets the same
 *   information a player gets, several turns later.
 */

/** soldFraction below this counts a turn toward `lowFillTurns`. */
export const STRANDED_LOW_FILL_THRESHOLD = 0.5;

/** Consecutive low-fill turns before the player-facing warning shows. */
export const STRANDED_WARN_TURNS = 6;

/** Consecutive low-fill turns before an NPP corp divests the plant. */
export const STRANDED_DIVEST_TURNS = 12;

/**
 * Cap on stranded divests per NPP corp per turn. Divests are instant deletes;
 * one per turn keeps a corp's exit gradual and its sector count stable enough
 * for the rest of the decision pass to reason about.
 */
export const STRANDED_DIVEST_MAX_PER_TURN = 1;

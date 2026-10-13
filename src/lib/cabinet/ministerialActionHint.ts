/**
 * Client-safe ministerial action copy.
 *
 * This module has no server-only imports precisely so client components can
 * share the reset hint with the API/turn copy rather than keep a second copy
 * that drifts. Keep it that way: no database, clock, `mongodb`, or `@/app`
 * imports here (the constants module is import-free). Server logic lives in
 * `./ministerialActionPool`.
 */
import {
  MINISTERIAL_ACTION_ACCRUAL_TURNS,
  MINISTERIAL_ACTION_CAP,
} from "@/lib/constants/cabinetMechanicsTypes";

export const MINISTERIAL_ACTION_RESET_HINT = `Regains 1 action every ${MINISTERIAL_ACTION_ACCRUAL_TURNS} turns, up to ${MINISTERIAL_ACTION_CAP}.`;

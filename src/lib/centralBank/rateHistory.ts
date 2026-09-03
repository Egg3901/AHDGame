import { ObjectId } from "mongodb";

/**
 * Server-side helpers for the bank's published rate history.
 *
 * Lives here rather than in `db/types/centralBank` because that module is
 * imported by client components (the prime-rate card reads the delta caps from
 * it), and a VALUE import of `mongodb` there would ship the driver into the
 * browser bundle and break `next build` — a failure neither typecheck nor
 * vitest can see. The types module keeps `RATE_HISTORY_MAX`, which is a plain
 * number and safe to share.
 */

/**
 * Stand-in actor for a rate change no character made: the autonomous technocrat
 * chair, or a committee resolving with no seated chair. `RateChangeRecord.changedBy`
 * is a required ObjectId, and the history must record such a move rather than
 * omit it — a history that silently drops every autonomous change is not a
 * history of the rate, and left the pre-1997 Bank of England showing an empty
 * ledger while its rate moved (#1250).
 */
export const SYSTEM_RATE_ACTOR = new ObjectId("000000000000000000000000");

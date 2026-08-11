import type { ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";

/**
 * Per directed-pair lock on the *ministerial* embargo lever. Written whenever a
 * cabinet member enacts an embargo on `targetCountry`; blocks a new ministerial
 * embargo on that pair until `cooldownUntilTurn`. Persists independently of the
 * embargo's own lifecycle (it outlives lift/expiry), so a minister can't lift
 * and immediately re-impose to dodge the cooldown. Legislation-origin embargoes
 * neither set nor honor this lock.
 */
export interface TradeEmbargoCooldown {
  _id: ObjectId;
  sourceCountry: CountryId;
  targetCountry: CountryId;
  /** Turn the most recent ministerial embargo on this pair was enacted. */
  lastEnactedTurn: number;
  /** A new ministerial embargo on this pair is blocked until this turn. */
  cooldownUntilTurn: number;
  /** Character who enacted the most recent ministerial embargo on this pair. */
  characterId: ObjectId;
}

/**
 * Live world facts the tutorial coach shows on a card.
 *
 * A step names the fact keys it wants; the coach fetches every fact once from
 * GET /api/tutorial/context and renders the ones it got back. Values arrive
 * pre-formatted as display strings so currency, percentage, and large-number
 * formatting live in one place on the server and the coach never has to know
 * about forex or country config.
 *
 * Any fact the server cannot compute is simply omitted, and the coach skips it.
 * That keeps a missing collection or an unseeded country from blanking a card.
 */

export const TUTORIAL_FACT_KEYS = [
  /** Current turn and how long until the next one. */
  "turn",
  /** The player's home region, by its country's own noun. */
  "region",
  /** Unemployment and population where the player lives. */
  "regionEconomy",
  /** The player's campaign funds and spare actions. */
  "wallet",
  /** How many parties are active in the player's country. */
  "parties",
  /** Races the player could file for in their home region right now. */
  "openSeats",
  /** Corporations in the player's country, and how many have no CEO. */
  "companies",
  /** Unions in the player's country, and how many have no leader. */
  "unions",
] as const;

export type TutorialFactKey = (typeof TUTORIAL_FACT_KEYS)[number];

export interface TutorialFact {
  /** Short caption, e.g. "Open races in Ohio". */
  label: string;
  /** Pre-formatted display value, e.g. "3 seats up". */
  value: string;
}

/** Every fact the server managed to compute, keyed by id. */
export type TutorialFacts = Partial<Record<TutorialFactKey, TutorialFact>>;

export function isTutorialFactKey(value: unknown): value is TutorialFactKey {
  return typeof value === "string" && (TUTORIAL_FACT_KEYS as readonly string[]).includes(value);
}

/** Narrow an untrusted API payload to the facts the coach can render. */
export function parseTutorialFacts(payload: unknown): TutorialFacts {
  if (!payload || typeof payload !== "object") return {};
  const out: TutorialFacts = {};
  for (const [key, fact] of Object.entries(payload as Record<string, unknown>)) {
    if (!isTutorialFactKey(key) || !fact || typeof fact !== "object") continue;
    const { label, value } = fact as { label?: unknown; value?: unknown };
    if (typeof label === "string" && typeof value === "string" && value.length > 0) {
      out[key] = { label, value };
    }
  }
  return out;
}

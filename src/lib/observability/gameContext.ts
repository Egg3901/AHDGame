/**
 * Game-context observability tags.
 *
 * Extends the existing user/character attribution with **game state** tags:
 * the current turn number and the character's political office. This turns
 * "something threw" into "something threw on turn 487 while the user was
 * playing a US Senator" — the difference between debugging a screenshot and
 * debugging a stack trace.
 *
 * Called after {@link setUserContext} in the auth guards. The turn number is
 * fetched lazily (one uncached `gameState.findOne`) because the auth guard
 * already has a DB connection open for the character lookup, and the gameState
 * read is a single-document find on an indexed `_id`.
 */
import * as Sentry from "@sentry/nextjs";
import type { OfficeType } from "@/lib/db/types/character";

/**
 * Tag the current request scope with game-turn context.
 *
 * @param turn   - The current game turn (from `gameState.currentTurn`).
 * @param office - The character's `currentOffice`, if any.
 */
export function setGameContext(turn: number, office?: OfficeType | null): void {
  Sentry.setTag("game.turn", turn);

  if (!office) {
    Sentry.setTag("game.office", "none");
    return;
  }

  const officeStr = officeLabel(office);
  Sentry.setTag("game.office", officeStr);

  // Use a plain record to safely access optional properties on the discriminated union.
  const props = office as unknown as Record<string, unknown>;
  if (props.state) {
    Sentry.setTag("game.officeState", String(props.state));
  }
}

/**
 * Human-readable label for an {@link OfficeType}, for Sentry tags and breadcrumbs.
 *
 * Returns a compact string like `"senate:CA"`, `"president"`, `"commons:OH"`,
 * `"chancellor"`, or `"house:TX"` — short enough for a tag value, unique enough
 * to filter GlitchTip issues by office type.
 */
export function officeLabel(office: OfficeType): string {
  const props = office as unknown as Record<string, unknown>;
  const state = props.state ? `:${props.state}` : "";
  const positionId = props.positionId ? String(props.positionId) : "";

  switch (office.type) {
    // US
    case "house":
      return `house${state}`;
    case "senate":
      return `senate${state}`;
    case "stateSenate":
      return `stateSenate${state}`;
    case "governor":
      return `governor${state}`;
    case "president":
      return "president";
    case "vicePresident":
      return "vicePresident";
    case "usCabinet":
      return `usCabinet:${positionId}`;
    // UK
    case "commons":
      return `commons${state}`;
    case "regionalCouncil":
      return `regionalCouncil${state}`;
    case "primeMinister":
      return `primeMinister${state}`;
    case "ukCabinet":
      return `ukCabinet:${positionId}`;
    case "parliamentaryCabinet":
      return `parliamentaryCabinet:${positionId}`;
    // DE
    case "bundestag":
      return `bundestag${state}`;
    case "chancellor":
      return "chancellor";
    case "ministerPresident":
      return `ministerPresident${state}`;
    case "landtag":
      return `landtag${state}`;
    case "deCabinet":
      return `deCabinet:${positionId}`;
    // Escape hatch
    default:
      return `${office.type}${state}`;
  }
}

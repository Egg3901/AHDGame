/**
 * The world facts that change what the tutorial says, not just the numbers on
 * a card.
 *
 * Two things vary by world:
 *  - the "what changed" edition. Each world launch gets its own curated set of
 *    changes, written against the world players are coming from. The edition is
 *    picked from the world's seed preset, so a world that has not been reset yet
 *    keeps the cards that are true for it.
 *  - the opening. A world started with no parties needs a "found a party" step
 *    where everyone else gets "join a party", and a world still in its founding
 *    round gets a card explaining that every office is up at once.
 *
 * Built from the shared world flags (GET /api/world/flags), which every signed-in
 * page already fetches, so the tour has the right shape before it opens.
 */

/** Which curated "what changed" set a world shows. */
export type WhatsNewEdition = "1991" | "general";

export interface TutorialWorld {
  edition: WhatsNewEdition;
  /** The playable countries opened with no parties; players found every one. */
  noStartingParties: boolean;
  /** Set while the founding round is running: the turns its races close on. */
  founding: { primaryEndTurn: number; generalEndTurn: number } | null;
}

export const DEFAULT_TUTORIAL_WORLD: TutorialWorld = {
  edition: "general",
  noStartingParties: false,
  founding: null,
};

/** The subset of world flags the tutorial reads. */
export interface TutorialWorldFlags {
  preset?: string | null;
  startingPartiesMode?: string | null;
  foundingRound?: { primaryEndTurn?: unknown; generalEndTurn?: unknown } | null;
}

export function whatsNewEditionForPreset(preset: string | null | undefined): WhatsNewEdition {
  return preset === "1991-default" ? "1991" : "general";
}

const isTurn = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value > 0;

export function tutorialWorldFromFlags(
  flags: TutorialWorldFlags | null | undefined
): TutorialWorld {
  if (!flags) return DEFAULT_TUTORIAL_WORLD;
  const round = flags.foundingRound;
  return {
    edition: whatsNewEditionForPreset(flags.preset),
    noStartingParties: flags.startingPartiesMode === "none",
    founding:
      round && isTurn(round.primaryEndTurn) && isTurn(round.generalEndTurn)
        ? { primaryEndTurn: round.primaryEndTurn, generalEndTurn: round.generalEndTurn }
        : null,
  };
}

/**
 * Every world shape that changes which steps exist. Tests walk all of them so a
 * variant step cannot ship with a missing catalog key or a broken link.
 */
export const TUTORIAL_WORLD_VARIANTS: TutorialWorld[] = [
  DEFAULT_TUTORIAL_WORLD,
  {
    edition: "1991",
    noStartingParties: true,
    founding: { primaryEndTurn: 25, generalEndTurn: 49 },
  },
  { edition: "1991", noStartingParties: false, founding: null },
];

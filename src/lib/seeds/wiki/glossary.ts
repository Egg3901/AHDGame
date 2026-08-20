/**
 * Player-facing wiki jargon glossary.
 *
 * Keys are the canonical term shown in tooltips. `aliases` are extra strings
 * that highlight the same entry. Matching is case-insensitive; the first
 * occurrence of a canonical entry per page is wrapped by the wiki renderer.
 *
 * Copy is player-facing: no em dashes or en dashes.
 */
export interface WikiGlossaryTerm {
  /** Short definition shown in the tooltip. */
  definition: string;
  /** Extra phrases that resolve to this same entry. */
  aliases?: readonly string[];
}

export const WIKI_GLOSSARY = {
  AP: {
    definition:
      "Action points. The spendable actions you get each turn (base 4, plus office and party bonuses). Most political work costs AP.",
    aliases: ["action points", "action point"],
  },
  PI: {
    definition:
      "Political Influence. State-level reputation built with Campaign actions. It feeds primary scores and general-election reach, and decays 0.75% per turn.",
    aliases: ["political influence"],
  },
  NPI: {
    definition:
      "National Political Influence. National name recognition. It grows from local PI and high office, does not decay each turn, and matters most in presidential races.",
    aliases: ["national political influence", "national influence"],
  },
  NPP: {
    definition:
      "Non-Player Politician. An autonomous politician the game generates to fill seats and primaries. NPPs vote, campaign, and follow whip directives.",
    aliases: ["non-player politician", "non-player politicians", "NPPs"],
  },
  GOTV: {
    definition:
      "Get Out The Vote. A party action that boosts demographic turnout in a state or region. It stacks with player canvassing, subject to the turnout cap.",
    aliases: ["get out the vote"],
  },
  FPTP: {
    definition:
      "First Past the Post. Winner-take-all: the candidate with the most votes wins the seat. Used in the US, UK, and Japan. Third parties can spoil races.",
    aliases: ["first past the post", "first-past-the-post"],
  },
  RCV: {
    definition:
      "Ranked Choice Voting. Voters rank candidates. If no one has a majority, last-place candidates are dropped and their votes transfer. Avoids the FPTP spoiler effect.",
    aliases: ["ranked choice voting", "ranked-choice voting"],
  },
  AMS: {
    definition:
      "Additional Member System. Germany's mixed-member proportional setup: some seats are local races, others are allocated so the chamber tracks party vote share.",
    aliases: ["additional member system"],
  },
  SOE: {
    definition:
      "State-owned enterprise. A government-run firm, one per strategic sector in planned economies. Directors set targets, investment, and labor mix.",
    aliases: ["state-owned enterprise", "state-owned enterprises", "state owned enterprise"],
  },
  IMF: {
    definition:
      "International Monetary Fund. The in-game institution that can bail out countries (and sometimes corporations) during sovereign or credit crises.",
  },
  cloture: {
    definition:
      "A vote to end debate and force a bill to the floor. In chambers that allow filibuster-style delay, cloture is how leadership closes debate.",
  },
  favorability: {
    definition:
      "Public approval of your character, 0 to 100. It feeds primary scores, general vote appeal, and national approval. Starts at 50 (neutral).",
  },
  appeal: {
    definition:
      "How strongly a demographic cell wants to vote for you. Built from policy match, favorability, endorsements, and related campaign effects.",
  },
  lean: {
    definition:
      "How far a state, region, or demographic cell sits toward one party or ideology. Lean shapes baseline vote share before campaigning.",
  },
  era: {
    definition:
      "The game's historical setting (for example Beta 2's 1991 map). Era gates units, tech, offices, and which countries are playable.",
  },
  bloc: {
    definition:
      "A voting or alliance group: legislative leadership blocs in Congress, or Cold War camps on the world map. Blocs vote and deal as a unit.",
  },
  extraction: {
    definition:
      "Pulling oil, coal, minerals, and other deposits out of a state. Capacity is finite; extraction contracts grant corporations a share of it.",
    aliases: ["extraction contract", "extraction contracts"],
  },
  apportionment: {
    definition:
      "How House (or equivalent) seats are divided among states or regions by population. After a census, apportionment can add or remove seats.",
  },
  canvassing: {
    definition:
      "A campaign action that raises turnout for one demographic in the state you are active in. Effect drops as you repeat it and doubles in campaign season.",
  },
  "primary score": {
    definition:
      "The 0 to 100 total that decides who wins a primary. It blends party alignment, favorability, and influence (PI or NPI). Highest per party advances.",
  },
  "party org": {
    definition:
      "Party organization in a state: ground infrastructure from 0 to 100. It scales general-election votes and feeds presidential primary scores.",
    aliases: ["party organization", "org score"],
  },
  whip: {
    definition:
      "Party leadership's instruction on how NPPs (and expected members) should vote on a bill. Players can defy a whip at an infamy cost.",
    aliases: ["whip directive", "whip directives"],
  },
  infamy: {
    definition:
      "A lasting penalty stat from attacks, whip defiance, and some dirty tricks. High infamy makes NPP endorsements harder. It decays slowly.",
  },
  alignment: {
    definition:
      "How close your economic and social positions are to a party platform or a voter group's ideology. Closer alignment raises primary scores and canvassing effect.",
  },
  "total appeal pipeline": {
    definition:
      "The per-turn formula that turns reach, appeal, approval, and party org into votes from each demographic cell. Used for live tallies and polls.",
  },
  "snap election": {
    definition:
      "An early parliamentary election called before the term ends (UK, Japan, Germany). It compresses the campaign cycle. See Snap Elections.",
    aliases: ["snap elections"],
  },
  filibuster: {
    definition:
      "A delay tactic that keeps a bill from closing. Cloture is the counter: a vote to end debate and move to passage.",
  },
} as const satisfies Record<string, WikiGlossaryTerm>;

export type WikiGlossaryKey = keyof typeof WIKI_GLOSSARY;

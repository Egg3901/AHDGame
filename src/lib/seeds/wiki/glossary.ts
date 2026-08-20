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
  "campaign season": {
    definition:
      "The final 4 turns before an election ends. Campaign passive effects (canvassing, media, opposition research) double during this window.",
  },
  "primary score": {
    definition:
      "The 0 to 100 total that decides who wins a primary. It blends party alignment, favorability, and influence (PI or NPI). Highest per party advances.",
  },
  "donor base": {
    definition:
      "Your fundraising level. Raise it with Build Donor Network. Higher levels earn more Campaign Funds per Fundraise and per turn.",
    aliases: ["donor network", "donor level"],
  },
  "party org": {
    definition:
      "Party organization in a state: ground infrastructure from 0 to 100. It scales general-election votes. Presidential primaries use party influence, not org.",
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
  turnout: {
    definition:
      "The share of a demographic cell that actually votes. Canvassing and GOTV raise it; it is capped and decays toward the baseline.",
  },
  "campaign funds": {
    definition:
      "Your political war chest. Raised by fundraising and office income. Spent on ads, polls, donor network, NPP influence, and campaign actions.",
  },
  "cash on hand": {
    definition:
      "Personal liquid cash, separate from Campaign Funds. Earned from passive income and a slice of personal donations. Used for player-to-player wires.",
  },
  primary: {
    definition:
      "The intra-party nomination phase. Candidates from the same party compete on primary score; the winner advances to the general.",
    aliases: ["primaries"],
  },
  "general election": {
    definition:
      "The inter-party contest after primaries. Votes accumulate each turn. The final 4 turns carry about 25% of the total pool.",
    aliases: ["generals"],
  },
  endorsement: {
    definition:
      "Formal support from a player or NPP. NPP endorsements grant campaign help and demographic appeal. Request them from nearby allied profiles.",
    aliases: ["endorsements"],
  },
  caucus: {
    definition:
      "A formal faction inside a party or chamber that votes as a bloc in leadership races and sometimes on bills.",
    aliases: ["caucuses"],
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
  turn: {
    definition:
      "One game week, processed every real hour. Actions refresh, elections tick, bills age, and markets settle when a turn runs.",
  },
  "home state": {
    definition:
      "The state or region your character is based in. It decides which local races you can enter and where canvassing is cheapest.",
    aliases: ["home region"],
  },
  "campaign manager": {
    definition:
      "A player assigned to run another candidate's campaign page: spending, upgrades, and operations. Used in presidential and some down-ballot races.",
  },
  "state senate": {
    definition:
      "The usual first office for new US players. Lower action and fund bonuses than Congress, but much easier to win from a cold start.",
  },
  filibuster: {
    definition:
      "A delay tactic that keeps a bill from closing. Cloture is the counter: a vote to end debate and move to passage.",
  },
  "ministerial actions": {
    definition:
      "The daily action pool for a cabinet seat (cabinet actions in presidential systems). They refill at midnight Eastern and cap at 4.",
    aliases: ["ministerial action", "cabinet actions", "cabinet action"],
  },
  SED: {
    definition:
      "Sozialistische Einheitspartei Deutschlands. East Germany's ruling party. The Volkskammer is elected on the single National Front list the SED leads.",
    aliases: ["Sozialistische Einheitspartei"],
  },
  "National Front": {
    definition:
      "East Germany's single electoral list. All Volkskammer seats are contested on it; the SED leads, and approved bloc parties take the rest.",
  },
  "command economy": {
    definition:
      "A planned economy: administered prices, state-owned enterprises, and a monobank instead of an independent central bank. Used by the USSR, China, and East Germany.",
    aliases: ["planned economy", "planned economies", "command economies"],
  },
  FOMC: {
    definition:
      "The 7-seat rate-setting board at a market central bank (Federal Open Market Committee in the US). The chair proposes; a majority of the full board must agree. Abstains count against.",
    aliases: ["federal open market committee"],
  },
  "world events": {
    definition:
      "Scheduled country-scope events the turn processor offers to a head of government. At most one pending offer per country per turn. Olympics and World's Fairs pick a host on a fixed cadence.",
    aliases: ["world event"],
  },
  SCOTUS: {
    definition:
      "The US Supreme Court: 9 seats. A justice seat does not occupy your current office. The President nominates; the Senate confirms by majority. Historical occupants replay until the first live confirmation.",
    aliases: ["supreme court", "Supreme Court"],
  },
} as const satisfies Record<string, WikiGlossaryTerm>;

export type WikiGlossaryKey = keyof typeof WIKI_GLOSSARY;

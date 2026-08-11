/**
 * Shared one-sentence definitions for the thematic command-economy terms, so
 * the dashboard and the three role panels surface the same plain-language
 * tooltip copy. Player-facing: no em or en dashes, no filler.
 */
export const CE_TERMS = {
  gosbank:
    "The state bank of a command economy: it hands out directed credit to the enterprises instead of a market setting interest rates.",
  gosplan:
    "The central planning office: it sets the national plan, the output quota every state enterprise is told to hit.",
  marketization:
    "How far the country has drifted from full central planning toward a market, on a 0 to 100 dial.",
  monetaryOverhang:
    "Money the state printed that has no goods to buy: it piles up as an index and pushes shortages higher.",
  issuance:
    "The slice of directed credit last turn that was printed rather than backed by real household savings.",
  upkeep:
    "The part of last turn's credit that only replaced worn-out plant. Enterprises have no other way to buy back what wears out, so this bill is paid even when you set credit to zero. Cutting credit stops new investment, not upkeep.",
  budgetSoftness:
    "How readily the bank bails out loss-making enterprises instead of letting the weak ones fold.",
  blackMarketPressure:
    "How hard shortages and the grey market are pushing the country toward the market, on a 0 to 100 scale.",
  shortage:
    "How far demand outruns what the plan delivers, on a 0 to 100 index: high means empty shelves.",
} as const;

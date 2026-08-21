export const ieOverviewContent = `# Ireland

Ireland is a **parliamentary republic**: a small open economy on the Atlantic edge of Europe. The **Taoiseach** leads the government through a majority in the 160-seat Dáil Éireann. The live allocator uses Hare-quota proportional representation with largest remainders; ranked STV transfers are not yet simulated.

---

## Government structure

| Office | How Filled | Term | Seats |
| --- | --- | --- | --- |
| Taoiseach (head of government) | Confidence vote of Dáil members | No fixed term | 1 |
| Tánaiste (deputy head of government) | Appointed by Taoiseach | No fixed term | 1 |
| Uachtarán na hÉireann (President, head of state) | Direct election | 7 years | 1 |
| Teachta Dála (TD) | Hare-quota multi-seat election | Modeled 4-year cycle | 160 |
| Cathaoirleach (regional executive) | FPTP regional election | 5 years | 1 per region |
| Local Councillor | Multi-seat local election | 5 years | 200 total |
| Governor of the Central Bank of Ireland | Appointed action | 4 years | 1 |

The **Taoiseach** is Ireland's head of government: equivalent to a Prime Minister. The **Uachtarán na hÉireann** (President of Ireland) is a ceremonial, non-executive head of state with a 7-year term, max 2 terms per character. The **Tánaiste** is the deputy head of government, filled through cabinet appointment.

The **Oireachtas** is the bicameral national legislature. However, the **Seanad Éireann** is partly elected, partly appointed, and does not participate in the player legislative loop, so the legislature is mechanically treated as **unicameral** (only Dáil bills advance to enactment). The Dáil is the sole legislative chamber where player-contestable bills originate.

---

## Oireachtas

The Oireachtas consists of two chambers:

- **Dáil Éireann**: 160 TDs (Teachtaí Dála) allocated proportionally across multi-seat constituencies using a **Hare quota and largest remainders**. This is the primary legislative chamber and the source of the Taoiseach's authority. **All 160 seats are contested** each election cycle.
- **Seanad Éireann**: 60 senators (43 elected from vocational panels, 11 nominated by the Taoiseach, and 6 from universities). The Seanad is partly elected and partly appointed, and is **not part of the player legislative loop**. Bills do not require Seanad passage to enact: the Dáil is the sole legislative body.

---

## Coalition threshold

The **coalition threshold is 81 seats** (a bare majority of the 160-seat Dáil: 160 / 2 + 1). A party or coalition holding 81+ seats can form a government and propose a Taoiseach through a confidence vote among all TDs.

**Minority government**: any party or coalition chair holding a sufficient bloc of Dáil seats can propose a Taoiseach and call a confidence vote, even without 81. The Dáil votes the bid up or down.

Ireland has no single-party majority tradition: **coalition government is the norm**. The two major parties are **Fine Gael** and **Fianna Fáil**, but neither typically governs alone. Coalitions typically include one of the major parties plus smaller partners (Labour, Greens, independents).

---

## How Irish elections work

Dáil elections currently use a generic **Hare-quota largest-remainder** allocator. This approximates proportional multi-seat results, but it does not model ranked ballots, surplus transfers, or eliminations. Wiki references to STV describe the real institution, not the live resolver.

- **Primaries advance the top 3 candidates** per party per region (same as the UK / JP / DE rule, not the US top-1 rule).
- **All Dáil seats are contested** in each cycle: no staggered classes.
- **Snap elections are allowed**: the Taoiseach can dissolve the Dáil and call an early election (mechanically similar to UK / JP / DE snap elections).
- **No confidence votes**: if the government loses Dáil confidence, the Taoiseach falls and government formation restarts.

---

## Local government

Ireland has a **Local Council** sub-national tier: 200 elected councillors representing NUTS-III planning regions. Councillors exercise delegated local-government functions and vote on regional legislation. Bills passed at the local level have regional policy effects.

Each region has a regional executive: the **Cathaoirleach**, using the same office as a Governor in other countries. The display label diverges per-region: Lord Mayor of Dublin (DUB), Lord Mayor of Cork (COR), Mayor of Limerick (LIM), Mayor of Galway (GAL), and Cathaoirleach elsewhere.

---

## Presidential office (Uachtarán)

The **Uachtarán na hÉireann** is a directly elected ceremonial head of state: distinct from the Taoiseach, who is the head of government. Key features:

Open the live office at [Áras an Uachtaráin](/country/ie/executive/aras).

- **7-year term**: the longest of any directly elected office in the game.
- **2-term lifetime limit per character**: a character cannot be elected to a third term, even after a break.
- **+3 actions per turn** while in office.
- **Party strength weight 0.5**: the ceremonial presidency carries less partisan weight than the Taoiseach or TDs.

The President does not introduce legislation and has no veto. The office is a strategic prestige / action-bonus target rather than a legislative lever.

---

## Key Irish mechanics

**Proportional lower-chamber allocator.** Ireland's Dáil uses the same generic Hare-quota proportional allocator used by several multi-seat chambers. A future true-STV implementation would need ranked ballots and transfer rounds that the current resolver does not perform.

**Unicameral legislative loop.** Although the Oireachtas is bicameral in name, only the Dáil participates in the player legislative loop. The Seanad is advisory-only: it cannot block or amend bills in gameplay.

**Coalition government by default.** Ireland's two major parties rarely win an outright Dáil majority. Coalitions (Fine Gael + Labour, Fianna Fáil + Greens, etc.) are the standard form of government. The 81-seat threshold is the only hard number that matters for confidence.

**Currency depends on era state.** Ireland starts with the Irish pound in pre-euro presets and can display the euro after Eurozone adoption. Its configured central-bank office is the **Governor of the Central Bank of Ireland**, not an independently contested ECB presidency.

**Social axis baseline −1.5.** Ireland's social-axis position starts slightly libertarian (−1.5 on a −5…+5 scale), reflecting a permissive, socially liberal baseline. Drifts toward the social stance of enacted national laws over time.

**Party creation routes through a charter.** Founding a new party requires drafting a [Party Charter](/wiki/political-parties) co-signed by 3 human founders. IE-specific gates don't apply. Ireland requires 2 regions (no locked home state) × 1 NPP per region = 2 NPPs spawned on creation.

---

## Career path for Irish players

| Stage | Target | Why |
| --- | --- | --- |
| Entry | Teachta Dála (TD) | +1 action/turn; national legislature access from the start |
| Mid-game | Cathaoirleach | +2 actions/turn; controls regional executive; 5-year term |
| Parallel | Uachtarán | +3 actions/turn; 7-year term; 2-term cap; ceremonial head of state |
| Top | Taoiseach | +4 actions/turn; heads government; requires Dáil majority |

Ireland has no sub-national legislature equivalent to the US State Senate or UK Regional Council. The Local Council is a sub-national elected tier, but the first rung of national play is a Dáil seat.

---

## Currency and economy

| Item | Detail |
| --- | --- |
| Currency | IEP before Eurozone adoption; EUR display after adoption |
| Central Bank | Central Bank of Ireland |
| Chair title | Governor of the Central Bank of Ireland |
| Default prime rate | 3.0% (shared across Eurozone) |
| Stock exchange | ISEQ |
| Finance Minister | Minister for Finance |

### Economic model

Ireland has **three seeded start years**: 1953, 1991, and 2019 (the default), each with its own authored national baseline and regional tilts:

| Era | Model | Description |
| --- | --- | --- |
| 1953 | Protectionist agrarian | De Valera-era Ireland: protectionist trade policy, mass emigration, punt pegged to sterling |
| 1991 | Agrarian | Pre-Celtic Tiger: a developing, largely agrarian economy |
| 2019 | Tech innovation | Modern Ireland: a tech-driven, FDI-led innovation economy |

A 2019-start Ireland begins as a **tech innovation** economy: the same modern model as the US. A 1991-start Ireland begins as agrarian and modernizes over time through play. A 1953-start Ireland begins earlier still, in the protectionist, high-emigration economy that preceded both.

---

## Key Ireland links

- [Cabinet Guide](/wiki/cabinet-guide): every cabinet post, its metrics, and its actions
- [Election Mechanics](/wiki/election-mechanics): Primary and general election rules
- [Multi-Country Play](/wiki/multi-country-play): proportional vs FPTP systems, cross-border investments
- [Core Systems](/wiki/core-systems): Turn structure, action economy
- [Player Progression](/wiki/player-progression): Career ladder details
- [International Organizations](/wiki/international-organizations): EU / ECB shared institutions
- [Referendums](/wiki/referendums): the Northern Ireland reunification path and its Dáil consent bill

---

## Living history

The timeline below is written by the turn processor whenever a head-of-government transition or national-scope bill enactment happens in-game. Each entry is a real event from this save.

\`\`\`country-history
IE
\`\`\`
`;

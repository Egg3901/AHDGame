export const brOverviewContent = `# Brazil

Brazil is a **federal presidential republic**: South America's largest democracy, with a directly elected President, a bicameral National Congress, and a fragmented multi-party system. The President serves a fixed 4-year term with a 2-term limit per character. Brazil's open-list proportional representation produces a highly fragmented legislature where coalition-building is essential despite the presidential system.

---

## Government structure

| Office | How Filled | Term | Seats |
| --- | --- | --- | --- |
| President | Direct election | 4 years | 1 |
| Vice President | Elected on presidential ticket | 4 years | 1 |
| Senator | FPTP statewide election (staggered) | 8 years (staggered) | 81 |
| Federal Deputy | Open-list PR from 5 multi-member macro-regional constituencies | 4 years | 513 |
| Governor | FPTP statewide election | 4 years | 1 per state (5) |
| Governor of the BCB | Appointed action | 4 years | 1 |

The **President** is both head of state and head of government: directly elected for a fixed 4-year term. There is no parliamentary confidence vote. A 2-term limit per character applies, and a second-term run blocks running-mate selection (the VP cannot be changed on a re-election bid).

The **National Congress** is bicameral and **both chambers participate in the player legislative loop**: bills require passage in both the Chamber of Deputies and the Federal Senate.

---

## National congress

Brazil's legislature has two chambers:

- **Chamber of Deputies**: 513 Federal Deputies elected by **open-list proportional representation** from 5 multi-member constituencies: the game models Brazil as five macro-regional states (Norte, Nordeste, Centro-Oeste, Sudeste, Sul), each electing a block of deputies sized by population. 4-year terms. **All seats are contested** each cycle. The Chamber is the primary legislative body and the source of the coalition threshold.
- **Federal Senate**: 81 senators, allocated across the five macro-regional states by population and serving **8-year staggered terms**. One-third and two-thirds of seats alternate per cycle (2 classes). The Senate reviews legislation from the Chamber and can amend or reject bills.

---

## Coalition threshold

The **coalition threshold is 257 seats** (a bare majority of the 513-seat Chamber of Deputies: 513 / 2 + 1). A party or coalition holding 257+ seats controls the Chamber.

Unlike parliamentary systems, the threshold does **not** determine who governs: the President is directly elected and serves a fixed term regardless of legislative composition. Instead, the 257-seat threshold matters for **legislative agenda control**: which party chairs committees, drives floor votes, and can override a presidential veto (a 2/3 supermajority in both chambers).

Brazil's open-list PR system produces **extreme party fragmentation**: no single party has won an outright Chamber majority in modern history. Governing coalitions typically span 5 to 10 parties. The two major parties are **PT** (Workers' Party, centre-left) and **PL** (Liberal Party, centre-right), but dozens of smaller parties hold decisive swing votes.

---

## How Brazilian elections work

Brazil uses **two different electoral systems** for its two chambers:

### Chamber of Deputies: open-list PR (D'Hondt)

Federal Deputies are elected by **open-list proportional representation** using the D'Hondt divisor method. Each of the five macro-regional constituencies elects a block of deputies proportional to the state's population. Voters cast a vote for an individual candidate, and seats are allocated to parties by vote share, then ordered by individual candidate vote totals within each party list.

- **All 513 seats are contested** each 4-year cycle.
- **No 5% threshold**: Brazil has no formal vote-share threshold to enter the Chamber, unlike Germany's Sperrklausel. Fragmentation is the natural outcome.
- **Primaries advance the top 3 candidates** per party per region.

### Federal Senate: FPTP staggered

Senators are elected by **First Past the Post (FPTP)** from statewide constituencies: each state's block of senators splits across two alternating 8-year classes, so only part of the chamber is up in any cycle.

- **Partial seats contested**: only one class of Senate seats is up per cycle (2 classes).
- **Single-member constituencies** for each contested seat.
- **No snap elections**: the Senate cannot be dissolved.

---

## Presidential elections

The President is **directly elected** by nationwide popular vote (no electoral college). A 2-term limit per character applies. A character who has served two full terms cannot run again. A second-term run blocks VP running-mate selection: the incumbent VP is locked onto the ticket.

Brazil has no parliamentary confidence vote. The President serves the full 4-year term regardless of congressional composition. **Divided government is the default**: one party holds the presidency while a rival coalition controls one or both chambers of Congress. Bills require passage in both chambers and presidential signature. The President can veto legislation; Congress can override with a 2/3 supermajority.

---

## Key Brazilian mechanics

**Two-term presidential limit.** A character cannot serve more than two terms as President. The limit is per-character, not per-party. A second-term run locks the VP running mate: the incumbent VP cannot be swapped.

**Bicameral legislative loop.** Both the Chamber and the Senate are player-contestable. Bills must pass both chambers to enact. There is no upper-chamber override asymmetry: both chambers have equal legislative weight.

**Fragmented legislature.** Open-list PR with no threshold produces 20+ parties in the Chamber. Coalition management is the central strategic challenge: even a unified presidential party needs allied blocs to pass legislation.

**Staggered Senate.** Only one class of Senate seats is up per cycle (2 classes, 8-year terms). Plan your Senate run for the correct class in your home state.

**No snap elections.** Both chambers have fixed terms. The President cannot dissolve Congress. No-confidence votes do not exist: the President serves the full term.

**Party creation routes through a charter.** Founding a new party requires drafting a [Party Charter](/wiki/political-parties) co-signed by 3 human founders. Brazil requires 3 states + locked home = 4 states × 2 NPPs = 8 NPPs spawned on creation.

**Social axis baseline 0.** Brazil starts at the center of the −5…+5 social axis. Drifts toward the social stance of enacted national laws over time.

---

## Career path for Brazilian players

| Stage | Target | Why |
| --- | --- | --- |
| Entry | Federal Deputy | +1 action/turn; national legislature access from the start |
| Parallel | Senator | +2 actions/turn; 8-year terms; staggered classes |
| Mid-game | Governor | +2 actions/turn; controls state executive; 4-year term |
| Top | President | +4 actions/turn; heads state and government; 2-term cap |

Brazil has no sub-national legislature. The first rung of national play is a Federal Deputy seat, contested via open-list PR in your home state.

---

## Currency and economy

| Item | Detail |
| --- | --- |
| Currency | BRL |
| Central Bank | Banco Central do Brasil (BCB) |
| Chair title | Governor of the BCB |
| Default prime rate | 8.0% |
| Stock exchange | B3 |
| Finance Minister | Minister of Finance |

### Economic model

Brazil has **four seeded start years**: 1953, 1979, 1991, and 2019 (the default). Each start authors its own national baseline and per-region tilts for the full set of Brazil's tracked economic, education, healthcare, infrastructure, and social metrics, so the starting economy looks materially different depending on which era you launch into:

| Era | Character |
| --- | --- |
| 1953 | Post-war import-substitution economy, early industrialization |
| 1979 | Late military-regime "miracle" hangover: high inflation, second oil shock pressure |
| 1991 | Pre-Real-Plan hyperinflation years (Collor-era recession and asset freeze), a young post-dictatorship democracy with a still-closed economy |
| 2019 | Modern Brazil: a resource-extraction-driven emerging market (commodity exports like soybeans, iron ore, oil, and meat dominate) |

A 1953 or 1979 start begins earlier in Brazil's industrialization arc; a 1991 start begins in hyperinflation and opens up over time through play; a 2019 start begins as a resource-extraction economy already integrated into modern global trade.

Brazil's monetary baseline also shifts by era: the game tracks a target inflation rate and a neutral prime rate per country, and Brazil's central bank Taylor rule reacts to the gap between actual and target inflation. The default (modern) target is 4% inflation with an 8% neutral prime rate. Earlier starts use different era-appropriate anchors: the 1953 anchor holds Brazil's target at 4%/8% (same as default, since 1953 Brazil is authored as running policy-target inflation rather than the historical Vargas-era CPI spike), while the 1979 anchor moves the target to 12% inflation with a 15% neutral prime rate, reflecting the military-regime "miracle" hangover. These anchors set what the BCB's Taylor rule treats as "on target," not a fixed rate that never moves: actual in-game inflation and the prime rate still respond to real conditions each turn.

---

## Key Brazil links

- [Election Mechanics](/wiki/election-mechanics): Primary and general election rules
- [Multi-Country Play](/wiki/multi-country-play): PR vs FPTP, cross-border investments
- [Core Systems](/wiki/core-systems): Turn structure, action economy
- [Player Progression](/wiki/player-progression): Career ladder details
- [Campaign Strategy](/wiki/campaign-strategy): Fundraising, ads, canvassing

---

## Living history

The timeline below is written by the turn processor whenever a presidential transition or national-scope bill enactment happens in-game. Each entry is a real event from this save.

\`\`\`country-history
BR
\`\`\`
`;

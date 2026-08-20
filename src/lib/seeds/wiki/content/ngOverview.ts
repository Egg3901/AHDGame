export const ngOverviewContent = `# Nigeria

Nigeria is a **federal presidential republic**: Africa's most populous democracy, with a directly elected President, a bicameral National Assembly, and 36 states plus the Federal Capital Territory. The President serves a fixed 4-year term with a 2-term limit per character. Nigeria uses First Past the Post (FPTP) for all federal elections, with single-member constituencies in both chambers.

Nigeria is fully authored (seeds, offices, and election systems) and is part of the **1991 scenario roster** (US, UK, JP, DE, CN, BR, IE, NG). Availability is seed and world dependent: a world seeded in an era that includes Nigeria can be played as Nigeria, while the current default world flags its status as coming soon.

---

## Government structure

| Office | How Filled | Term | Seats |
| --- | --- | --- | --- |
| President | Direct election | 4 years | 1 |
| Vice President | Elected on presidential ticket | 4 years | 1 |
| Senator | FPTP statewide election | 4 years | 109 |
| Representative | FPTP district-level election | 4 years | 360 |
| Assembly Member (State House of Assembly) | FPTP zone election | 4 years | 990 |
| Governor | FPTP statewide election | 4 years | 1 per state (36) |
| Governor of the CBN | Appointed action | 5 years | 1 |

The **President** is both head of state and head of government: directly elected for a fixed 4-year term. A 2-term limit per character applies, and a second-term run blocks running-mate selection (the VP cannot be changed on a re-election bid).

The **National Assembly** is bicameral and **both chambers participate in the player legislative loop**: bills require passage in both the Senate and the House of Representatives.

---

## National Assembly

Nigeria's legislature has two chambers:

- **House of Representatives**: 360 Representatives elected by **FPTP from single-member constituencies** across Nigeria's 36 states and the Federal Capital Territory. 4-year terms. **All seats are contested** each cycle. The House is the primary legislative body and the source of the coalition threshold.
- **Senate**: 109 senators elected by **FPTP from single-member statewide constituencies** (3 per state plus 1 for the FCT). 4-year terms. **All seats are contested** each cycle. The Senate reviews legislation from the House and can amend or reject bills.

---

## Coalition threshold

The **coalition threshold is 181 seats** (a bare majority of the 360-seat House of Representatives: 360 / 2 + 1). A party or coalition holding 181+ seats controls the House.

Unlike parliamentary systems, the threshold does **not** determine who governs: the President is directly elected and serves a fixed term regardless of legislative composition. Instead, the 181-seat threshold matters for **legislative agenda control**: which party chairs committees, drives floor votes, and can override a presidential veto (a 2/3 supermajority in both chambers).

Nigeria's two major parties are **APC** (All Progressives Congress, centre-right) and **PDP** (Peoples Democratic Party, centre-left). Unlike Brazil's highly fragmented system, Nigeria's two-party dominance produces clearer legislative majorities, but cross-party coalitions still matter for veto overrides and constitutional amendments.

---

## How Nigerian elections work

Nigeria uses **First Past the Post (FPTP)** for all federal elections: the same electoral system as the US. Single-member constituencies mean one winner per district, no proportional representation.

- **All seats are contested** in each 4-year cycle: no staggered classes.
- **Single-member constituencies** for both chambers.
- **No snap elections.** Both chambers have fixed 4-year terms. The President cannot dissolve the National Assembly.
- **No confidence votes.** The President serves the full term regardless of legislative composition.
- **Primaries**: same primary rules as the US baseline.

The **spoiler effect** applies through major-party modelling: APC and PDP are the two dominant parties. A third-party candidate splits the anti-incumbent vote, typically helping the incumbent party.

---

## Presidential elections

The President is **directly elected** by nationwide popular vote. A 2-term limit per character applies. A character who has served two full terms cannot run again. A second-term run locks the VP running mate: the incumbent VP cannot be swapped.

Nigeria has no parliamentary confidence vote. The President serves the full 4-year term regardless of National Assembly composition. **Divided government is common**: one party holds the presidency while a rival controls one or both chambers. Bills require passage in both chambers and presidential signature. The President can veto legislation; the National Assembly can override with a 2/3 supermajority.

---

## Key Nigerian mechanics

**Two-term presidential limit.** A character cannot serve more than two terms as President. The limit is per-character, not per-party. A second-term run locks the VP running mate: the incumbent VP cannot be swapped.

**Bicameral legislative loop.** Both the House and the Senate are player-contestable. Bills must pass both chambers to enact. Both chambers have equal legislative weight: there is no upper-chamber override asymmetry.

**FPTP single-member constituencies.** Nigeria is the only non-US country using pure FPTP with single-member districts for **both** chambers. This produces geographic-concentration-driven outcomes: a party with concentrated regional support overperforms relative to its national vote share.

**State House of Assembly.** Each of Nigeria's six geopolitical zones elects Assembly Members to a 990-seat State House of Assembly (the "Assembly Member" office), allocated by zone population: North West 259, North East 137, North Central 146, South West 197, South South 134, South East 117.

**No snap elections.** Both chambers have fixed 4-year terms. The President cannot dissolve the National Assembly.

**No confidence votes.** The President serves the full term. There is no legislative mechanism to remove the President mid-term through a standard vote.

**Party creation routes through a charter.** Founding a new party requires drafting a [Party Charter](/wiki/political-parties) co-signed by 3 human founders. Nigeria requires 3 states + locked home = 4 states × 2 NPPs = 8 NPPs spawned on creation.

**High-inflation monetary baseline.** Nigeria's central bank operates at a structurally higher rate environment than other countries: target inflation of 6.0% and a neutral prime rate of 12.0% reflect the naira's historical weakness.

---

## Career path for Nigerian players

| Stage | Target | Why |
| --- | --- | --- |
| Entry | Assembly Member | +1 action/turn; cheapest race, builds favorability and PI in your home zone |
| Parallel | Representative | +1 action/turn; national legislature access |
| Mid-game | Senator or Governor | +2 actions/turn; either federal upper chamber or state executive |
| Top | President | +4 actions/turn; heads state and government; 2-term cap |

The State House of Assembly is Nigeria's sub-national legislature: the cheapest entry point, similar to a US State Senate seat.

---

## Currency and economy

| Item | Detail |
| --- | --- |
| Currency | NGN |
| Central Bank | Central Bank of Nigeria (CBN) |
| Chair title | Governor of the CBN |
| Default prime rate | 12.0% |
| Stock exchange | None |
| Finance Minister | Minister of Finance |
| Initial exchange rate | 1550 NGN per internal unit |

### Monetary baselines

Nigeria's central bank operates at a structurally higher rate environment than other countries:

| Baseline | Value |
| --- | --- |
| Target inflation | 6.0% |
| Neutral prime rate | 12.0% |
| Initial exchange rate | 1550 NGN per internal unit (≈ 0.00064 USD per NGN) |

These baselines reflect the naira's historical weakness and Nigeria's inflationary macro environment. The CBN Governor's prime rate decisions ripple through borrowing costs, inflation, and GDP growth nationwide.

**Era note.** These are the modern (1999+) anchors. A 1953-start world runs Nigeria under the colonial sterling peg instead: target inflation 2.0% and neutral prime rate 3.5%, imported UK-level price stability rather than the post-independence naira regime. The anchors graduate automatically as a world's in-game year advances past 1971/1979/1991.

---

## Key Nigeria links

- [Cabinet Guide](/wiki/cabinet-guide): every cabinet post, its metrics, and its actions
- [Election Mechanics](/wiki/election-mechanics): Primary and general election rules
- [Multi-Country Play](/wiki/multi-country-play): FPTP vs PR, cross-border investments
- [Core Systems](/wiki/core-systems): Turn structure, action economy
- [Player Progression](/wiki/player-progression): Career ladder details
- [Campaign Strategy](/wiki/campaign-strategy): Fundraising, ads, canvassing

---

## Living history

The timeline below is written by the turn processor whenever a presidential transition or national-scope bill enactment happens in-game. Each entry is a real event from this save.

\`\`\`country-history
NG
\`\`\`
`;

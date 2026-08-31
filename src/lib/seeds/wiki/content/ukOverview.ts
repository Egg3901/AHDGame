export const ukOverviewContent = `# United Kingdom

The United Kingdom is a **constitutional monarchy and parliamentary democracy** across four nations. There is no directly elected executive: the **Prime Minister** emerges from whichever party can command a majority in the 650-seat House of Commons. Elections can be called early (snap elections). Governments can fall mid-term via no-confidence votes.

---

## Government structure

| Office | How Filled | Term | Seats |
| --- | --- | --- | --- |
| Prime Minister | Confidence vote of Commons MPs | No fixed term | 1 |
| Member of Parliament (MP) | Regional multi-seat election | Up to 5 years | 650 modern / 625 in 1953 |
| Regional Councillor | Multi-seat regional election | Up to 5 years | 578 total |
| Monarch | Imperial character (ceremonial) | Lifetime | 1 |
| Governor of the Bank of England | Appointed action | 4 years | 1 |

**Parliament** consists of two chambers:

- **House of Commons**: 650 elected MPs from single-member constituencies across four nations. This is the primary legislative chamber and the source of the PM's authority.
- **House of Lords**: 784 appointed and hereditary peers. Revises and scrutinises legislation but cannot block it indefinitely. Lords are not elected and cannot be filled by players.

---

## Nations and election regions

The UK has four nations, but the Commons resolver runs one multi-seat race in each of 12 regions. England is split into nine regions; Scotland, Wales, and Northern Ireland each form one region.

| Region | Code | Modern Commons Seats | Regional Council Seats |
| --- | --- | --- | --- |
| London | LON | 75 | 32 |
| South East England | SEE | 90 | 67 |
| South West England | SWE | 58 | 39 |
| East of England | EAE | 60 | 39 |
| East Midlands | EMI | 47 | 39 |
| West Midlands | WMI | 57 | 18 |
| Yorkshire and the Humber | YHU | 54 | 21 |
| North West England | NWE | 75 | 27 |
| North East England | NEE | 27 | 17 |
| Scotland | SCO | 57 | 129 |
| Wales | WAL | 32 | 60 |
| Northern Ireland | NIR | 18 | 90 |

The 1953 preset uses its own 625-seat Commons map. Your character's home region normally determines where you can stand for Commons, while party leaders have broader access.

---

## How UK elections work

UK Commons elections use **regional multi-seat allocation**. In modern game years, each region's seats are allocated by the Hare largest-remainder path. Before 1999, the same exact-seat allocator applies a square-law majoritarian bonus to the leading electoral pair, which produces a stronger FPTP-style squeeze on smaller parties.

A party needs at least **20% of pooled regional votes** to qualify in the modern proportional path. The pre-1999 majoritarian path lowers that gate to 10% before applying its winner's bonus.

**Primaries advance the top 3 candidates** (not 1 as in the US). Three candidates from each party advance to the general election per nation.

**No fixed election date.** Commons elections have a maximum five-year term but can be called earlier by the government (snap elections) or triggered by a successful no-confidence vote.

---

## Prime Minister selection

There is no direct vote for Prime Minister. Instead:

1. After Commons elections resolve across all 12 regions, seat totals are summed by party.
2. The **largest party** (by seats) attempts to form a government.
3. A **confidence vote** is held among all 650 elected MPs. The nominee needs more than 50% (326 votes) to be confirmed as PM.
4. If the confidence vote fails, the next-largest party's leader is nominated, and the process repeats.
5. **Minority government**: any party or coalition chair holding at least 100 Commons seats can call a confidence vote and propose a PM, even when a rival bloc has 326+. The Commons votes the bid up or down.

The PM serves until a new Commons election, resignation, or removal by no-confidence vote. There is no fixed term.

---

## Snap elections and no-confidence votes

These are the two mechanics that have no US equivalent:

**Snap elections**: The governing party can trigger an early Commons election before the five-year maximum. This resets all four nations' elections simultaneously. Used strategically when the government believes its poll position is strong.

**No-confidence votes**: Any MP can table a motion of no confidence against the sitting PM. If it passes (majority of MPs vote yes), the PM is removed immediately, the cabinet is cleared, and government formation restarts. This means a PM who loses their Commons majority can be ousted mid-term.

The [Snap Elections](/wiki/snap-elections) guide covers the mechanics and costs in detail.

---

## Regional councils

Each of the 12 UK regions has an elected Regional Council. Councillors propose and vote on regional legislation. Scotland, Wales, Northern Ireland, and London also have elected regional executives who handle assent; English regions without an executive use the configured regional enactment path. Total council seats: **578**.

Winning a Regional Council seat and a Commons seat are mutually exclusive: winning one vacates the other.

In Scotland, Wales, and Northern Ireland, the Regional Council represents the devolved legislature (Scottish Parliament, Senedd Cymru, Northern Ireland Assembly).

---

## The Monarch

The UK has an [imperial character](/wiki/imperial-characters): the Monarch. This is a ceremonial head-of-state role. The Monarch manages the **Royal Estate** corporation, while the elected government controls legislation and executive policy. The Monarch has no vote on legislation or the PM; Royal Assent to national bills is automatic.

---

## Key UK mechanics

**No presidential veto.** When a bill passes the Commons, it receives Royal Assent automatically and is enacted immediately. There is no executive signature step.

**Cabinet resets on government change.** When a new PM is appointed after a confidence vote or no-confidence vote, the entire cabinet is cleared. All ministerial positions become vacant and pending nominations are withdrawn.

**Major parties vary by nation.** When evaluating spoiler effects, the game uses different major-party sets by nation: Labour/Conservative in England, SNP/Labour in Scotland, Labour/Conservative in Wales, DUP/Sinn Féin in Northern Ireland.

**Party creation routes through a charter.** Founding a new party requires drafting a [Party Charter](/wiki/political-parties) co-signed by 3 human founders. The charter system is country-agnostic; UK-specific gates (presidential-primary lockout) don't apply here.

**Government approval** is computed from the country's own metrics and the national effects layered on them (a war, a national address, international statements, the state of the cabinet), not from the PM's favorability. See [Government Approval](/wiki/government-approval).

**The Chancellor's Budget changes the law.** The annual Budget bundles real tax rates and statutory programme levels (the NHS included) into one Commons confidence vote. It shares a single fiscal ledger with ordinary legislation, so a later Act or a later Budget controls each setting; the Treasury page shows a forecast of revenue, spending, balance and the tax phase-in before the package is tabled. If no Chancellor is appointed, the Prime Minister may act until the vacancy is filled.

**The Bank of England answers to the Treasury before 1997.** A world that opens before the 1997 independence grant starts with the Treasury setting Bank Rate and no rate committee; Parliament can legislate the transfer either way. There is no FOMC-style committee here in any era: the Governor sets the rate alone once the bank is independent.

---

## Currency and economy

| Item | Detail |
| --- | --- |
| Currency | GBP |
| Central Bank | Bank of England (BoE) |
| Chair title | Governor of the Bank of England |
| Default prime rate | 3.0% |
| Stock exchange | FTSE |
| Finance Minister | Chancellor of the Exchequer |

---

## Key UK links

- [UK overview](/wiki/uk-overview): Commons elections, government formation, confidence votes
- [Snap Elections](/wiki/snap-elections): How and when snap elections are triggered
- [Cabinet Guide](/wiki/cabinet-guide): every cabinet post, its metrics, and its actions
- [Referendums](/wiki/referendums): independence and Northern Ireland reunification campaigns
- [Election Mechanics](/wiki/election-mechanics): Shared primary/general concepts
- [Core Systems](/wiki/core-systems): Turn structure, action economy
- [Player Progression](/wiki/player-progression): Career ladder details

---

## Living history

The timeline below is written by the turn processor whenever a head-of-government transition or national-scope bill enactment happens in-game. Each entry is a real event from this save.

\`\`\`country-history
UK
\`\`\`
`;

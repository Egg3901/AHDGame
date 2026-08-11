export const ukOverviewContent = `# United Kingdom

The United Kingdom is a **constitutional monarchy and parliamentary democracy** across four nations. There is no directly elected executive: the **Prime Minister** emerges from whichever party can command a majority in the 650-seat House of Commons. Elections can be called early (snap elections). Governments can fall mid-term via no-confidence votes.

---

## Government structure

| Office | How Filled | Term | Seats |
| --- | --- | --- | --- |
| Prime Minister | Confidence vote of Commons MPs | No fixed term | 1 |
| Member of Parliament (MP) | FPTP regional election | Up to 5 years | 650 |
| Regional Councillor | Multi-seat regional election | Up to 5 years | 364 |
| Monarch | Imperial character (ceremonial) | Lifetime | 1 |
| Governor of the Bank of England | Appointed action | 4 years | 1 |

**Parliament** consists of two chambers:

- **House of Commons**: 650 elected MPs from single-member constituencies across four nations. This is the primary legislative chamber and the source of the PM's authority.
- **House of Lords**: 784 appointed and hereditary peers. Revises and scrutinises legislation but cannot block it indefinitely. Lords are not elected and cannot be filled by players.

---

## Four nations

The UK is divided into four nations, each running separate Commons elections:

| Nation | Code | Commons Seats | Devolved Body |
| --- | --- | --- | --- |
| England | ENG | 543 | None |
| Scotland | SCO | 57 | Scottish Parliament |
| Wales | WAL | 32 | Senedd Cymru |
| Northern Ireland | NIR | 18 | Northern Ireland Assembly |

Your character's home nation determines where you can stand for Commons (party leaders may stand in any nation). Regional Councillors represent 12 sub-regions within these nations, with a total of 364 council seats.

---

## How UK elections work

UK Commons elections use **multi-seat proportional allocation** within each nation, not single-winner FPTP like the US. Each nation elects a block of MPs (543 in England, 57 in Scotland, 32 in Wales, 18 in Northern Ireland), and seats are allocated proportionally using the largest-remainder method.

A party needs at least **20% of votes** within a nation to qualify for seats. The FPTP spoiler effect still applies through major-party modelling: in England, Labour and Conservative are the two dominant parties; in Scotland, SNP and Labour; in Northern Ireland, DUP and Sinn Féin are the major forces.

**Primaries advance the top 3 candidates** (not 1 as in the US). Three candidates from each party advance to the general election per nation.

**No fixed election date.** Commons elections have a maximum five-year term but can be called earlier by the government (snap elections) or triggered by a successful no-confidence vote.

---

## Prime Minister selection

There is no direct vote for Prime Minister. Instead:

1. After Commons elections resolve across all four nations, seat totals are summed by party.
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

Each of the 12 UK sub-regions has an elected Regional Council. These function similarly to US State Senates: councillors propose and vote on regional legislation, which takes effect without a governor veto (Bills auto-enact on passage). Total council seats: 364.

Winning a Regional Council seat and a Commons seat are mutually exclusive: winning one vacates the other.

In Scotland, Wales, and Northern Ireland, the Regional Council represents the devolved legislature (Scottish Parliament, Senedd Cymru, Northern Ireland Assembly).

---

## The Monarch

The UK has an **imperial character**: the Monarch. This is a unique in-game role with a ceremonial head-of-state function. The Monarch manages the **Royal Estate** corporation (real estate sector). The government is styled "His/Her/The Monarch's Government" based on the current Monarch's gender. The Monarch has no vote on legislation or the PM: Royal Assent to bills is automatic.

---

## Key UK mechanics

**No presidential veto.** When a bill passes the Commons, it receives Royal Assent automatically and is enacted immediately. There is no executive signature step.

**Cabinet resets on government change.** When a new PM is appointed after a confidence vote or no-confidence vote, the entire cabinet is cleared. All ministerial positions become vacant and pending nominations are withdrawn.

**Major parties vary by nation.** When evaluating spoiler effects, the game uses different major-party sets by nation: Labour/Conservative in England, SNP/Labour in Scotland, Labour/Conservative in Wales, DUP/Sinn Féin in Northern Ireland.

**Party creation routes through a charter.** Founding a new party requires drafting a [Party Charter](/wiki/political-parties) co-signed by 3 human founders. The charter system is country-agnostic; UK-specific gates (presidential-primary lockout) don't apply here.

**Government approval** is derived from the PM's favorability rating, not an aggregate of regional metrics as in some other systems.

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

- [UK Elections](/wiki/uk-elections): Commons elections, government formation, confidence votes
- [Snap Elections](/wiki/snap-elections): How and when snap elections are triggered
- [Cabinet Guide](/wiki/cabinet-guide): every cabinet post, its metrics, and its actions
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

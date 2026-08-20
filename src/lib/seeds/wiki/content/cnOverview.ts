export const cnOverviewContent = `# China

China is a **one-party state** with a non-democratic political system. The **Premier** leads the State Council through confidence of the 2,980-seat National People's Congress, but the **Chinese Communist Party (CCP)** is the ruling party by design. No-confidence votes are blocked at runtime. The **President** is a ceremonial head of state, auto-populated as whoever currently holds the CCP chair. China is the world's second-largest economy.

---

## Government structure

| Office | How Filled | Term | Seats |
| --- | --- | --- | --- |
| Premier (head of government) | Internal party confidence | 5 years | 1 |
| President (ceremonial head of state) | Auto-populated as CCP chair | No fixed term | 1 |
| NPC Delegate | FPTP regional election | 5 years | 2,980 |
| Provincial Delegate (People's Congress) | FPTP sub-national election | 5 years | 4,000 total |
| Governor (provincial executive) | FPTP provincial election | 5 years | 1 per province |
| Governor of the PBoC | Appointed action | 5 years | 1 |

The **Premier** is China's head of government, the executive office that drives the State Council.

The **President** is a **ceremonial head of state**: not elected and not appointed through the Premier flow. The office is auto-populated as whoever currently holds the **CCP chair**, and updates automatically whenever the chair changes. The President carries **+0 actions per turn** and **0 party strength weight**, so the office has no mechanical weight beyond its ceremonial label.

---

## National People's Congress

The **National People's Congress** is the national legislature. Despite a bicameral name, it is **mechanically unicameral**: only the NPC participates in the player legislative loop.

- **National People's Congress (NPC)**: 2,980 delegates representing provinces, municipalities, autonomous regions, the armed forces, and special administrative regions. **5-year terms. All seats contested** each cycle. This is the sole legislative body where player-contestable bills originate.
- **CPPCC** (Chinese People's Political Consultative Conference): 2,169 members representing diverse social and economic constituencies. The CPPCC is an **advisory body** and is **not part of the player legislative loop**. It cannot block or amend bills.

The coalition threshold is **1,491 seats** (a bare majority of 2,980: 2980 / 2 + 1). Since the CCP is the ruling party by design and no other party competes, this threshold is a formality: the ruling party always holds the NPC majority.

---

## One-party constraints

China is one-party by design. Several runtime constraints enforce this:

- **No-confidence votes blocked.** The vote-of-no-confidence path is skipped entirely for China, not fired and rejected. The Premier cannot be removed by a legislative vote mid-term.
- **Single ruling party.** The CCP is marked as the ruling party at seed time. Only one party competes in elections.
- **No snap elections.** The Premier cannot dissolve the NPC. Election terms are fixed at 5 years.
- **Internal party confidence model.** Leader transitions are tracked separately from other countries, and the turn pipeline drives confidence drift each turn. This is the CN-specific substitute for the parliamentary confidence vote.

---

## Internal party confidence

China is the only country with a **ruling-party confidence model**. Instead of a legislative confidence vote, the CCP's internal dynamics drive leadership transitions:

- **9-axis priority profile**: ideological weights that shift based on enacted policy.
- **Per-turn confidence drift**: ruling-party confidence is recomputed each turn based on policy-axis effects, popular mood, and economic signals.
- **Popular mood profile**: public-mood axis weights driving legitimacy drift.
- **Faction split**: when Stage 3 (internal challenge) fires, an auto-faction-split spawns the **"Democratic Faction of the CCP"** as a spinoff party. This is the only path by which a second party can emerge.

The **President** is auto-synced to the CCP chair: when the party chair changes, the President updates to match automatically.

---

## Constitutional convention (regime conversion)

CN is the only country with a **regime-conversion / constitutional convention** system. If ruling-party confidence collapses to a critical threshold, a Stage-4 forced conversion fires:

- **Collapse target system**: a parliamentary republic by default.
- **Convention allowlist**: parliamentary republic or presidential. The player can negotiate either target. One-party state is excluded from the list, since conversion only ever runs one way.
- **Legacy seat reservation**: 20% of post-conversion legislature seats granted to the former ruling party by default. The Stage-4 forced path always uses 5% (and halves it to 3% if a "resist" decision was taken).
- **Election delay**: 24 turns by default before the first post-conversion election.

This is the only path by which China can transition out of one-party rule. Once converted, there is no path back.

---

## Provincial government

China is organized around **Provinces**. Each province has:

- A **Provincial People's Congress**: the sub-national elected legislature, totaling 4,000 delegates across all provinces. 5-year terms. Members vote on provincial legislation.
- A **Governor**: the provincial executive, directly elected. +2 actions/turn, 5-year term.

The provincial tier is mechanically analogous to US State Senates or UK Regional Councils, but with a CN-specific fiscal model.

### One-party regional budget

CN has a unique **two-source regional-budget model**: local tax retention plus central transfer grants:

| Knob | Value | Description |
| --- | --- | --- |
| Local tax retention share | 0.40 | Share of enterprise income tax (EIT) that stays local |
| Corporate profit ratio | 0.06 | Corporate profits as a fraction of regional GDP |
| Central transfer per capita | 35 (CNY/year) | Default central transfer pool per capita |
| Default tax rate | 25% | Fallback when no primary tax has been enacted |
| Primary tax | Enterprise Income Tax | Enterprise income tax legislation |
| Resource tax | Provincial Resource Tax | Optional per-region resource tax |
| Resource extraction ratio | 0.03 | Mining/oil/gas/water/salt as a fraction of regional GDP |
| Business tax consumption ratio | 0.50 | Consumption base for the standing Business Tax (营业税) |
| Business tax rate | 24% | Standing Business Tax rate (1991-era local tax) |

The **Business Tax (营业税)** was the dominant 1991-era Chinese local tax, replaced by VAT modernization over time. The **Enterprise Income Tax (EIT)** is the modern primary regional revenue stream, with 40% retained locally and 60% remitted to the central government.

---

## How Chinese elections work

NPC and Provincial People's Congress elections use **FPTP** with a CN-specific primary override:

- **Up to 7 CCP candidates may advance from each region's primary**: the multi-seat PR general phase distributes seats across a 7-NPP-per-region caucus instead of collapsing to a single delegate per region.
- **All seats contested** in each cycle (no staggered classes).
- **5-year terms** for both NPC and Provincial People's Congress.
- **No snap elections.** Terms are fixed.

The 7-candidate primary override is the key CN electoral mechanic: it ensures the NPC reflects regional CCP caucus diversity rather than a single winner-take-all delegate per province.

---

## Key Chinese mechanics

**One-party by design.** The CCP is the ruling party by seed. No other party competes in elections. No-confidence votes are blocked at runtime. The Premier cannot be removed mid-term by a legislative vote.

**Internal confidence, not legislative confidence.** Leadership transitions run through the internal-party confidence model, not a Dáil/Commons-style confidence vote. The 9-axis priority profile and popular mood profile drive drift each turn.

**Ceremonial President auto-sync.** The President is not elected: the office auto-populates as whoever holds the CCP chair. When the chair changes, the President updates automatically.

**Regime conversion is one-way.** If ruling-party confidence collapses, a constitutional convention can convert China to a parliamentary republic or presidential system. There is no path back to one-party rule. The former ruling party retains a legacy seat reservation (5 to 20% depending on path).

**Party role labels.** CN uses localized party-role labels: chair → **"General Secretary"**, vice chair → **"Deputy General Secretary"**, committee → **"Secretariat"**. These override the default English labels.

**Party creation routes through a charter.** Founding a new party requires drafting a [Party Charter](/wiki/political-parties) co-signed by 3 human founders. CN requires 2 provinces (no locked home) × 1 NPP = 2 NPPs spawned on creation. In practice, party creation is constrained by the one-party regime.

**Social axis baseline +3.5.** China starts significantly authoritarian (+3.5 on a −5…+5 scale), the most authoritarian baseline of any country in the game. Drifts toward the social stance of enacted national laws over time.

---

## Career path for Chinese players

| Stage | Target | Why |
| --- | --- | --- |
| Entry | NPC Delegate | +1 action/turn; national legislature access from the start |
| Parallel | Provincial Delegate | +1 action/turn; 5-year terms; provincial legislation |
| Mid-game | Governor | +2 actions/turn; controls provincial executive; 5-year term |
| Top | Premier | +4 actions/turn; heads State Council; internal-party confidence |

The Premier is the top of the ladder, but it requires internal-party confidence, not a legislative vote. The ceremonial President carries no mechanical weight (+0 actions, 0 party strength).

---

## Currency and economy

| Item | Detail |
| --- | --- |
| Currency | CNY |
| Central Bank | People's Bank of China (PBoC) |
| Chair title | Governor of the PBoC |
| Default prime rate | 4.0% |
| Stock exchange | SSE |
| Finance Minister | Minister of Finance |

### Economic model

China has **four seeded start years**: 1953, 1979, 1991, and 2019 (the default), each with its own authored national baseline and regional tilts:

| Era | Model | Description |
| --- | --- | --- |
| 1953 | Early command economy | First Five-Year Plan, Soviet-model industrialization, near-total illiteracy |
| 1979 | Barely-reformed command economy | Deng era opening: household responsibility system pilots, first SEZs, trade still minimal |
| 1991 | Agrarian | Pre-reform: a developing, largely agrarian/reforming economy |
| 2019 | Industrial powerhouse | Modern China: the world's manufacturing powerhouse |

A 2019-start China begins as an **industrial powerhouse** economy, the same model as Germany and Japan. A 1991-start China begins as agrarian and industrializes over time through play. Earlier starts (1953, 1979) begin further back in China's development arc, well before the reform-era opening. Sector-supported identities (e.g. **State-Capitalist**) emerge via the 67%+ state-ownership lever once the government actually nationalizes: sectors start unowned.

---

## Key China links

- [Cabinet Guide](/wiki/cabinet-guide): every cabinet post, its metrics, and its actions
- [Election Mechanics](/wiki/election-mechanics): Primary and general election rules
- [Multi-Country Play](/wiki/multi-country-play): One-party vs parliamentary vs presidential
- [Core Systems](/wiki/core-systems): Turn structure, action economy
- [Player Progression](/wiki/player-progression): Career ladder details
- [International Trade](/wiki/trade-system): CNY exchange, tariffs, FTAs

---

## Living history

The timeline below is written by the turn processor whenever a Premier transition or national-scope bill enactment happens in-game. Each entry is a real event from this save.

\`\`\`country-history
CN
\`\`\`
`;

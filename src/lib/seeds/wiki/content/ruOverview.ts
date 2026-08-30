import { getPlayerStartScenarios } from "../startingStateScenarios";

const ruScenarios = getPlayerStartScenarios("RU")
  .map(
    (scenario) =>
      `### ${scenario.title}\n\n**First office:** ${scenario.officeLabel} (\`${scenario.officeType}\`)\n\n*${scenario.hook}*\n\n${scenario.path}`
  )
  .join("\n\n");

export const ruOverviewContent = `# Soviet Union

The Soviet Union is a **one-party socialist state** playable in the **1953 and 1979 presets**. The **Communist Party of the Soviet Union (CPSU)** is the only seeded party: unlike China's united-front model there are no satellite parties at all. The **Premier** (Chairman of the Council of Ministers) is the head of government; the **Chairman of the Presidium** is a ceremonial head of state elected by a joint sitting of the legislature. The **Supreme Soviet** is genuinely bicameral, and the economy is a centrally planned command economy run through **Gosplan** and **Gosbank**.

---

## Government structure

| Office | How Filled | Term | Seats |
| --- | --- | --- | --- |
| Premier (head of government) | Nominated by a party chair, confirmed by Soviet of the Union deputies | 4 years | 1 |
| Chairman of the Presidium (ceremonial head of state) | Elected by a joint sitting of both chambers | No fixed term | 1 |
| Supreme Soviet Deputy | Multi-seat regional election | 4 years | 559 (526 in 1953) |
| Nationalities Deputy | Multi-seat republic-weighted election | 4 years | 515 |
| Republic Deputy | Multi-seat sub-national election | 4 years | 5,000 total |
| Republic First Secretary | Regional executive election | 4 years | 1 per region |
| Chairman of Gosbank | Appointed action | 5 years | 1 |

The Premier carries **+4 actions per turn**; a Supreme Soviet or Nationalities Deputy +1; a Republic First Secretary +2; the Chairman of Gosbank +3. The Chairman of the Presidium carries +0 actions and zero party-strength weight: the office is a ceremonial capstone, not a power base.

---

## The Supreme Soviet

Unlike China's mechanically unicameral NPC, the Supreme Soviet is **bill-active bicameral**: a bill must clear **both chambers** to become law.

- **Soviet of the Union**: **559 deputies** (526 in the 1953 preset), apportioned to the 14 macro-regions by population. Four-year terms, all seats contested each cycle. (The historical chamber seated 750; the seats of Ukraine, Byelorussia and the Baltic republics left with those countries, which the game models separately.)
- **Soviet of Nationalities**: **515 deputies**, seated by republic rather than by population: 25 seats per union republic, 11 per autonomous republic, with a floor of 20 per region so every region has contestable seats.

Both chambers elect **on the same day** on a shared four-year cycle (anchored to 1954 in the 1953 preset and 1984 in the 1979 preset). Republic Supreme Soviets, the sub-national tier, run their own four-year cycle (1955 / 1980). There are **no snap elections**.

The coalition threshold is a bare majority of the Soviet of the Union: **376 seats** (355 in 1953). Since the CPSU is the sole party, the threshold is a formality. The seeded government starts **formed**, with the CPSU holding a majority mandate from turn one.

When the last Supreme Soviet election of a cycle resolves, a **convocation reset** fires: the Premier's chair reopens for reappointment and the Chairman of the Presidium is cleared so the new chambers elect the head of state afresh.

Historical composition follows the single-list convention of the era: the CPSU takes about **75 percent** of each chamber and the remaining quarter seats as non-party deputies.

---

## One-party rule

The USSR runs the shared one-party-state regime system (see [One-Party States](/wiki/one-party-states)):

- **The CPSU is the only seeded party.** No approved satellite parties exist, which makes the USSR stricter than China or East Germany.
- **Vote multipliers**: ruling-party votes weigh 3.0, approved parties 0.375, independents and banned parties 0. Player-created parties are **automatically banned** at charter ratification.
- **No-confidence votes are skipped entirely.** One-party states have no legislative confidence mechanism, and coalition loss cannot collapse the government.
- **Internal party confidence** replaces the confidence vote. The ruling leader starts at 75 confidence, gains +5 on renewal (capped at 95), and drifts each turn with policy alignment, popular mood and economic signals. Degrading confidence walks the regime through the four-stage escalation chain.
- **Faction split**: at Stage 3 an auto-split spawns the **"Reformist Faction of the CPSU"** as a spinoff party, the only organic path to a second party.
- **Regime conversion is one-way.** The collapse target is a parliamentary republic (the convention allowlist adds presidential). A negotiated convention reserves 20 percent of post-conversion seats for the former ruling party; the forced Stage-4 path reserves 5 percent (3 if the leader resisted) and delays the first election 12 turns instead of the default 24.

Party role labels are localized: chair reads **"General Secretary"**, vice chair **"Second Secretary"**, committee **"Politburo"**. The social axis baseline is **+3.5**, tied with China for the most authoritarian start in the game.

---

## The 14 macro-regions

The union is modelled as **14 macro-regions** ("Republics" in the UI): ten covering the RSFSR and four covering the other union republics (Kazakhstan, Transcaucasia, Central Asia, Moldova). Ukraine, Byelorussia and the Baltic republics are modelled as their own countries and are not USSR regions. Each has a Republic Supreme Soviet and a directly elected **Republic First Secretary** (the governor office, who also signs regional bills).

| Region | Union seats (1979) | Nationalities seats |
| --- | --- | --- |
| Central Russia | 81 | 25 |
| Northwest Russia | 38 | 22 |
| European North | 17 | 20 |
| Central Black Earth | 23 | 20 |
| Volga | 58 | 44 |
| North Caucasus | 43 | 33 |
| Urals | 55 | 22 |
| West Siberia | 35 | 20 |
| East Siberia | 23 | 20 |
| Russian Far East | 20 | 20 |
| Kazakhstan | 42 | 25 |
| Transcaucasia | 40 | 108 |
| Central Asia | 73 | 111 |
| Moldova | 11 | 25 |

The 1953 preset reapportions the Union chamber to 526 seats on 1953 populations; the Nationalities table is population-independent and identical in both eras. Ukraine, Byelorussia and the Baltic republics are their own countries, and their deputies sit in their own legislatures, not the Supreme Soviet.

---

## Council of Ministers

The Premier appoints ministers **directly from Supreme Soviet deputies** to a 16-seat Council of Ministers. Every seat carries a three-option **tier setting** (the middle option is the neutral default), a package of national metrics, and **two ministerial orders**: time-limited national modifiers that cost one ministerial action and run 24 turns (one game half-year). Most line ministries also get a regional target and an emergency action aimed at a single republic.

The portfolios that define the Soviet council:

| Seat | Tier setting | Orders |
| --- | --- | --- |
| Chairman of Gosplan (planning) | Plan Emphasis: producer goods (Group A) vs consumer goods (Group B) | Mid-Plan Revision, Shock Work Campaign |
| Council Liaison to Gosbank (state bank) | Credit Plan: tight credit vs loose credit | Currency Reform Tranche, Enterprise Credit Release |
| Minister of Foreign Trade (the trade monopoly) | Trade Monopoly Posture: autarky vs export drive | Hard Currency Drive, Technology Import Programme |
| Minister of Internal Trade (distribution) | Goods Distribution Priority: producer vs consumer priority | Consumer Goods Release, Retail Network Expansion |
| Minister of Agriculture (collective farming) | Procurement Quotas: light vs heavy | Land Reclamation Drive, Procurement Price Rise |
| Minister of Machine Building and Heavy Industry | Combine Output Setting: modernization vs over-fulfilment | Combine Output Drive, Machine Tool Retooling |
| Minister of Internal Affairs (internal security) | Internal Security Posture: thaw vs crackdown | Public Order Sweep, Internal Passport Audit |
| Minister of Culture | Cultural Line: liberal vs orthodox | Mass Literacy Campaign, Union Cultural Festival |

The Foreign and Internal Trade seats are deliberately distinct levers: Foreign Trade tiers act on growth through the state import-export monopoly, Internal Trade tiers act on consumer costs and employment through domestic distribution. The remaining seats (First Deputy Chairman, Foreign Affairs, Defence, Finance, Railways, Health, Higher Education) follow the same tier-plus-orders pattern. See the [Cabinet Guide](/wiki/cabinet-guide) for every seat.

---

## Command economy

When an admin enables command economy, the USSR comes up **fully command**: its marketization level is scheduled at **10** through 1991 in both presets, far below the dual-track band. See [Planned Economies](/wiki/planned-economies) for the full model.

- **No stock exchange.** State enterprises are recorded against the **GOSPLAN state register**, and founding private corporations is disallowed.
- **One state-owned enterprise per sector.** Every industry on the sector board has a plan enterprise with plant capacity (heavy industry, energy, extraction, agriculture, consumer goods, defense, chemicals, transport, and the rest).
- **The three seats are wired to real offices.** The Gosplan planner panel is operated by the Chairman of Gosplan cabinet seat and the state-credit panel by the Gosbank liaison; SOE directors are appointed per enterprise.
- **The dial is earned.** Black-market pressure, chronic plan under-fulfilment and a reformist policy stance push marketization up; a disciplined orthodox plan holds it down indefinitely. The CPSU's economic position of -4 feeds the policy driver toward orthodoxy.
- **Fixed ruble.** The SUR is non-convertible while the country is command: forex routes refuse open-market trades, the monobank stays passive, and shortage shows up as empty shelves and a black-market premium rather than price spikes.

---

## The Warsaw Pact and the Cold War

The **Warsaw Pact** is the socialist bloc's collective-defense alliance, seeded from 1952 and dissolved on schedule in 1991. Founding members are the USSR, East Germany, Poland, Hungary, Romania, Bulgaria and Czechoslovakia; the 1953 preset adds Albania, which is gone by 1979.

- **Moscow holds permanent leadership.** The pact's chair, the **Supreme Commander of the Unified Command**, is permanently assigned to the USSR. No other member can ever hold it.
- **Tribute.** In worlds that began at the 1953 preset, the two armed blocs (NATO and the Warsaw Pact only) levy a fixed tribute on non-voting client members instead of voted dues.
- **Alignment.** Between 1945 and 1990 the world runs on a WEST vs EAST alignment axis; the Warsaw Pact is the EAST bloc's accession channel, opposite NATO.
- **Conflicts are player-made.** The world starts with **no pre-seeded wars**. Every conflict on the board was started by a player declaration or a world event, and declare-war bills need a two-thirds majority even in a one-party state (the only bill class that keeps its supermajority here). See [Conflicts Overview](/wiki/conflicts-overview).

---

## Career path for Soviet players

| Stage | Target | Why |
| --- | --- | --- |
| Entry | Republic Deputy | +1 action/turn; republic legislation; 4-year terms |
| Entry | Supreme Soviet or Nationalities Deputy | +1 action/turn; national legislature and the pool ministers are drawn from |
| Mid-game | Republic First Secretary | +2 actions/turn; regional executive; signs republic bills |
| Mid-game | Council of Ministers seat | Tier setting, two orders, and (Gosplan/Gosbank) the command-economy panels |
| Top | Premier | +4 actions/turn; appoints the Council; held through internal party confidence |

---

## Starting scenarios

${ruScenarios}

---

## Currency and economy

| Item | Detail |
| --- | --- |
| Currency | SUR (Soviet ruble, administered rate) |
| Central Bank | State Bank of the USSR (Gosbank) |
| Chair title | Chairman of Gosbank |
| Default prime rate | 3.0% |
| State register | GOSPLAN (no bourse) |
| Finance Minister | Minister of Finance |

The 1979 budget models the Brezhnev-era pattern: slowing growth, suppressed inflation held near 1 percent by administered prices, and "financing the national economy" as the largest spending line. The 1953 budget is calibrated on the turnover tax as the dominant revenue source and infrastructure at roughly 30 percent of spending.

---

## Key Soviet links

- [One-Party States](/wiki/one-party-states): regime tiers, escalation, reforms and conversion
- [Planned Economies](/wiki/planned-economies): the full command-economy model
- [Cabinet Guide](/wiki/cabinet-guide): every cabinet post, its metrics, and its actions
- [International Organizations](/wiki/international-organizations): the Warsaw Pact, Comecon and alignment
- [Conflicts Overview](/wiki/conflicts-overview): declaring war, fronts and occupation
- [Core Systems](/wiki/core-systems): turn structure, action economy

---

## Living history

The timeline below is written by the turn processor whenever a Premier transition or national-scope bill enactment happens in-game. Each entry is a real event from this save.

\`\`\`country-history
RU
\`\`\`
`;

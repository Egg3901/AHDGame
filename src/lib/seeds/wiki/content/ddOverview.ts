import { getPlayerStartScenarios } from "../startingStateScenarios";

const ddScenarios = getPlayerStartScenarios("DD")
  .map(
    (scenario) =>
      `### ${scenario.title}\n\n**First office:** ${scenario.officeLabel} (\`${scenario.officeType}\`)\n\n*${scenario.hook}*\n\n${scenario.path}`
  )
  .join("\n\n");

export const ddOverviewContent = `# East Germany

East Germany (the German Democratic Republic) is a **one-party socialist state** playable in the **1953 and 1979 presets**. The ruling **SED** (Sozialistische Einheitspartei Deutschlands) governs through the **National Front**, a single electoral list it shares with four allied bloc parties. The **General Secretary** is the head of government; the **Chairman of the Council of State** is a ceremonial head of state auto-synced to the SED chair. The **Volkskammer** is the unicameral legislature and the economy is centrally planned.

---

## Government structure

| Office | How Filled | Term | Seats |
| --- | --- | --- | --- |
| General Secretary (head of government) | Internal party confidence | 5 years | 1 |
| Chairman of the Council of State (ceremonial head of state) | Auto-populated as SED chair | No fixed term | 1 |
| Volkskammer Deputy | Single-list regional election | 4-year cycle | 500 |
| Land First Secretary (regional executive) | Regional election | 4 years | 1 per region |
| President of the Staatsbank | Appointed action | 6 years | 1 |

The General Secretary carries **+4 actions per turn**, a Volkskammer Deputy +1, a Land First Secretary +2, the Staatsbank President +3. The Chairman of the Council of State carries +0 actions and zero party-strength weight, and updates automatically whenever the SED chair changes (the China pattern). In the 1953 preset the head-of-government seat reads **"First Secretary"**, the SED leader's title until 1976.

---

## The Volkskammer

The **Volkskammer** (People's Chamber) is mechanically **unicameral**: 500 deputies elected on the single National Front list, all seats contested each cycle, no snap elections. The **Staatsrat** (Council of State), a 25-seat collective head-of-state body, is not elected and sits outside the player legislative loop.

Elections ride a **four-year cycle** (anchored to 1954 in the 1953 preset and 1981 in the 1979 preset, matching the GDR's early electoral cadence). Land First Secretary races ride the same anchor. The coalition threshold is **251 seats** (500 / 2 + 1), a formality given the seeded majority.

The seeded composition mirrors the National Front's fixed allocation:

| Party | 1953 seats | 1979 seats |
| --- | --- | --- |
| SED | 292 | 290 |
| CDU (Ost) | 51 | 52 |
| LDPD | 51 | 52 |
| NDPD | 51 | 52 |
| DBD | 55 | 54 |

Because single-list elections carry no real electoral signal, governance participation for one-party states is capped at a ceiling of 55, and the FPTP spoiler step is skipped entirely.

---

## The National Front

The National Front is the bloc-party version of one-party rule (see [One-Party States](/wiki/one-party-states)): five seeded parties, one list, one permitted outcome.

- **SED** is the **ruling** party (economic position -4): the only party that can form government, field executive candidates, or move a no-confidence vote (which one-party states skip anyway).
- **CDU (Ost), LDPD, NDPD and DBD** are **approved** bloc parties. They hold seats, field Volkskammer candidates, propose and vote on bills, accept donations and sit in cabinet, but they **cannot form government** or contest the executive.
- **Vote multipliers**: ruling votes weigh 3.0, approved 0.375, independents and banned parties 0. Player-created parties are automatically **banned** at charter ratification.
- **No internal confidence gauge.** Unlike the USSR and China, East Germany does not run the ruling-party leader-confidence model, and no faction split spawns a spinoff party. The regime's popular legitimacy still drifts each turn on the shared one-party mood profile.
- **Collapse points west.** The collapse target is a parliamentary republic: the reunification and democratisation path. Conversion is one-way.

---

## The six regions

East Germany is modelled as **6 regions**, each with a Land legislature and a directly elected **Land First Secretary** who signs regional bills. Volkskammer seats are apportioned by region:

| Region | Volkskammer seats (1979) | Seats (1953) |
| --- | --- | --- |
| Berlin (Ost) | 35 | 32 |
| Mecklenburg-Vorpommern | 64 | 58 |
| Brandenburg | 81 | 71 |
| Sachsen-Anhalt | 91 | 112 |
| Sachsen | 153 | 151 |
| Thüringen | 76 | 76 |

Sachsen is the industrial heart and the largest delegation in both eras. The historical seat bundle seats the national chamber only: no Landtag composition is pre-seeded.

---

## Council of Ministers

The GDR's Council of Ministers mirrors the Soviet council **one for one**: the same 16 portfolios, tier settings and levers, under GDR-authentic names. The General Secretary appoints ministers directly from Volkskammer deputies. Every seat carries a three-option tier setting and **two ministerial orders** (24-turn national modifiers costing one ministerial action).

The distinctive seats:

| Seat | What it runs |
| --- | --- |
| Chairman of the State Planning Commission | Plan Emphasis: producer goods vs consumer goods; Mid-Plan Revision and Shock Work Campaign orders |
| Council Liaison to the Staatsbank | Credit Plan: tight vs loose credit; Currency Reform Tranche, Enterprise Credit Release |
| Minister of Foreign Trade | Trade Monopoly Posture: autarky vs export drive |
| Minister of Trade and Supply | Goods Distribution Priority: producer vs consumer priority |
| Minister of Agriculture, Forestry and Food | Procurement Quotas over the collectivized LPG farms |
| Minister of Heavy Industry and Machine Building | Combine Output Setting: modernization vs over-fulfilment |
| Minister for State Security | Internal Security Posture: thaw vs crackdown |
| Minister of Culture | Cultural Line: liberal vs orthodox (seat exists from 1954) |

Era gating is real: the **Minister of National Defence seat only exists from 1956**, when the NVA stands up (before that the KVP sits under the Interior portfolio), and the Staatsbank liaison reads "Deutsche Notenbank" before the 1968 rename. See the [Cabinet Guide](/wiki/cabinet-guide).

---

## Command economy

East Germany comes up **fully command** when the command-economy regime is on: its marketization level is scheduled at **10** through 1990 in both presets. See [Planned Economies](/wiki/planned-economies).

- **No stock exchange.** State enterprises are recorded against the **VVB** (Vereinigung Volkseigener Betriebe) register, and founding private corporations is disallowed.
- **One state-owned enterprise per sector.** Every industry has a VEB-style enterprise with plant capacity (manufacturing, chemicals, energy, extraction, automobiles, agriculture, and the rest of the sector board). All are headquartered administratively in East Berlin.
- **Planning runs through the cabinet.** East Germany's planning levers live on the ordinary State Planning Commission and Staatsbank liaison cabinet seats; the dedicated planner and state-credit consoles are wired for the USSR and China only.
- **Fixed Mark.** The DDM is administered and non-convertible while the country is command. The 1953 preset pins it at 4.2 to the dollar; open inflation stays near half a percent because prices are set by the plan, and the 1979 budget carries the GDR's hidden hard-currency debt to the West.

---

## Military and the Warsaw Pact

East Germany is a **founding member of the Warsaw Pact** in both eras. The pact's permanent chair, the Supreme Commander of the Unified Command, is held by the USSR: no other member can ever hold it. Between 1945 and 1990 the pact is the EAST bloc's accession channel on the Cold-War alignment axis, opposite NATO.

**A 1953 world seeds East Germany with zero military branches.** The Nationale Volksarmee stands up in 1956: Land Forces (LaSK), People's Navy (VM) and Air Force / Air Defence (LSK/LV) all carry a 1956 establishment year and dissolve with the state in 1990. This is correct, not a bug. The world starts with no pre-seeded wars; every conflict is player-declared. See [Conflicts Overview](/wiki/conflicts-overview).

---

## Career path for East German players

| Stage | Target | Why |
| --- | --- | --- |
| Entry | Volkskammer Deputy | +1 action/turn; the pool ministers are appointed from |
| Mid-game | Land First Secretary | +2 actions/turn; regional executive; signs Land bills |
| Mid-game | Council of Ministers seat | Tier setting and two orders on a real portfolio |
| Top | General Secretary | +4 actions/turn; appoints the Council; head of government |

Bloc-party players cap out below the executive: an approved party can take any seat up to cabinet, but the top office belongs to the ruling party until the regime liberalizes or converts.

---

## Starting scenarios

${ddScenarios}

---

## Currency and economy

| Item | Detail |
| --- | --- |
| Currency | DDM (Mark der DDR, administered rate) |
| Central Bank | Staatsbank der DDR (SBD) |
| Chair title | President of the Staatsbank |
| Default prime rate | 5.0% |
| State register | VVB (no bourse) |
| Finance Minister | Minister of Finance |

---

## Key East Germany links

- [One-Party States](/wiki/one-party-states): regime tiers, escalation, reforms and conversion
- [Planned Economies](/wiki/planned-economies): the full command-economy model
- [Cabinet Guide](/wiki/cabinet-guide): every cabinet post, its metrics, and its actions
- [International Organizations](/wiki/international-organizations): the Warsaw Pact and alignment
- [Conflicts Overview](/wiki/conflicts-overview): declaring war, fronts and occupation
- [Core Systems](/wiki/core-systems): turn structure, action economy

---

## Living history

The timeline below is written by the turn processor whenever a head-of-government transition or national-scope bill enactment happens in-game. Each entry is a real event from this save.

\`\`\`country-history
DD
\`\`\`
`;

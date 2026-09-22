export const deOverviewContent = `# Germany

Germany is a **federal parliamentary republic** that uses **mixed-member proportional representation (AMS)** for its legislature. The Chancellor heads the government but is not directly elected. No single party has won an outright majority in decades of German political history, making coalition-building the norm rather than the exception.

---

## Government structure

| Office | How Filled | Term | Seats |
| --- | --- | --- | --- |
| Chancellor | Confidence vote of Bundestag members | No fixed term | 1 |
| Member of Bundestag (MdB) | Mixed-member proportional (AMS) | 4 years | 487 in the 1953 preset; 630 modern |
| Minister-President | Sub-national election | 5 years | 1 per state (11) |
| Federal President | Ceremonial (not player-facing) | 5 years | 1 |
| President of the ECB | Appointed action | 4 years | 1 |

**The Bundestag** is the primary legislative chamber. Germany's upper chamber is the **Bundesrat**, representing the German states (Länder). Bundesrat members are appointed by state governments, not elected by players directly.

The **Federal President** is a ceremonial head of state (like the UK Monarch), not the head of government. The head of government is the Chancellor.

---

## 11 German states (Länder)

The 1953 seed models West Germany: 11 federal states. Each state elects its own Minister-President, who is the sub-national executive equivalent to a US Governor. Minister-Presidents also influence the Bundesrat's composition.

The 11 states are: Baden-Württemberg, Bavaria, Berlin, Bremen, Hamburg, Hesse, Lower Saxony, North Rhine-Westphalia, Rhineland-Palatinate, Saarland, Schleswig-Holstein.

The five eastern states from reunified Germany (Brandenburg, Mecklenburg-Vorpommern, Saxony, Saxony-Anhalt, Thuringia) belong to East Germany (DD), which is a separate playable country in this era.

### Reunification

The German Question can end the division. If the East wins the question (by a settlement on the diplomatic track, or by winning a war the question attached to), East Germany is absorbed into a single Germany and the East arrives **intact**: the Volkskammer's members take their places in the Bundestag, land assemblies become Landtage, Land First Secretaries become Minister-Presidents, East Berlin is folded into Berlin, and the eastern parties cross over as real parties with their treasuries, registration and members. Seats carried across are rescaled onto the delegation the Bundestag already holds for the five eastern Länder rather than adding a whole second chamber. The unified state is **one-party**, with the parties of the East governing and the western parties barred, it inherits the East's law catalogue alongside its own, it leaves NATO as it joins the Warsaw Pact, and it deliberately calls **no election**: the chamber that was just carried across is the point of the settlement. See [One-Party States](/wiki/one-party-states) and [East Germany](/wiki/dd-overview).

---

## How German elections work

Germany's Bundestag uses the **Additional Member System (AMS)**, also called Mixed-Member Proportional (MMP). This is fundamentally different from US FPTP or UK multi-seat allocation.

Under AMS:
- Voters elect candidates through a proportional party-list mechanism.
- Seat allocation across the Bundestag is proportional to each party's vote share.
- The chamber's size follows the era: **487 seats** in the 1953 preset (the 2nd Bundestag), **630** in the modern one, where the 2023 reform fixed the size with no overhang mandates.

A party needs at least **5% of the national vote** to enter the Bundestag (the Sperrklausel threshold). Parties that fall below this threshold receive no seats, even if they win significant support in individual states.

**Snap elections.** As in the UK and Japan, the sitting Chancellor may dissolve the Bundestag and call a snap election. Snap windows are compressed (24h primary + 24h general) and run per Land. A pending PM vacancy that exceeds the 96-turn deadline also auto-triggers a snap. See [Snap Elections](/wiki/snap-elections) for the full mechanics.

---

## Chancellor selection

There is no direct vote for Chancellor. The process mirrors the UK's confidence mechanism:

1. After Bundestag elections, the largest party or coalition with a majority negotiates government formation.
2. A **confidence vote** among all Bundestag members confirms the Chancellor.
3. The coalition threshold is a bare majority of the chamber: 244 of 487 seats in the 1953 preset, 316 of 630 in the modern one.
4. **Minority government**: any party or coalition chair holding a sizeable bloc of Bundestag seats can propose a Chancellor and call a confidence vote, even when a rival bloc holds the majority. The Bundestag votes the bid up or down.

In real-world Germany, removing a sitting Chancellor requires a **constructive vote of no confidence**: the Bundestag must simultaneously agree on a replacement before the incumbent can be voted out. *In-game, the simulation currently uses the same standard no-confidence mechanic as the UK and Japan*: a passed vote of no confidence sends the government into a pending state and a 96-turn vacancy clock arms. Modeling the constructive variant is a future enhancement.

---

## Bundestagspräsident

The Bundestag elects a presiding officer (**Bundestagspräsident**) by simple majority among MdBs. The role mirrors the US Speaker of the House mechanically: open declarations from majority-bloc MdBs, a 24-hour voting window, and a plurality winner. It is constitutionally distinct, though: the Bundestagspräsident ranks **second** in the German order of precedence after the Bundespräsident, and presides over Bundestag sessions, sets the agenda, and recognizes speakers.

---

## Coalition culture

Coalition government is the default in Germany. The two major parties are **SPD** (Social Democrats, centre-left) and **CDU/CSU** (Christian Democrats, centre-right), but neither typically wins a majority alone. Common coalition patterns include:

- **Grand Coalition**: SPD + CDU/CSU (ideologically opposed parties governing together)
- **Traffic Light**: SPD + Greens + FDP
- **Jamaica**: CDU + Greens + FDP

In-game, coalition mechanics determine which party controls the Chancellor's office and how cabinet seats are distributed across coalition partners.

---

## Key German mechanics

**Constructive no-confidence.** Unlike the UK, removing the Chancellor requires simultaneously installing a replacement. A pure vote of no confidence that doesn't name a successor fails, even with a majority against the sitting Chancellor.

**No fixed Chancellor term.** The Chancellor serves as long as they hold the Bundestag's confidence. A majority government can last the full four-year legislative period without a confidence vote challenge.

**Bundesrat.** The upper chamber is appointed by state governments, so as Minister-Presidents win and lose elections, the Bundesrat's composition shifts. The Bundesrat can delay or block certain categories of legislation, particularly those affecting state responsibilities.

**AMS means proportional outcomes.** Unlike FPTP systems, vote share translates more directly into seat share. A party with 25% support gets roughly 25% of seats. This rewards consistent national support rather than geographic concentration.

**European Central Bank.** Germany uses the **Euro (EUR)** and shares the **ECB** with other Eurozone countries. The ECB's prime rate (shared across all EU member countries in-game) is set by the ECB President, a role that can be contested in-game. Germany's finance minister is titled Chancellor of Finance (Finanzminister).

**Party creation routes through a charter.** Founding a new party requires drafting a [Party Charter](/wiki/political-parties) co-signed by 3 human founders. The charter system is country-agnostic; DE-specific gates don't apply.

---

## Career path for German players

| Stage | Target | Why |
| --- | --- | --- |
| Entry | Member of Bundestag (MdB) | +1 action/turn; national legislature access from the start |
| Mid-game | Minister-President | +2 actions/turn; controls state executive; Bundesrat influence |
| Top | Chancellor | +4 actions/turn; heads government; requires Bundestag majority |

Germany has no sub-national legislature equivalent to the US State Senate or UK Regional Council. The first rung is a national Bundestag seat rather than a local office. This means new German players immediately compete in national elections rather than starting locally.

---

## Currency and economy

| Item | Detail |
| --- | --- |
| Currency | EUR |
| Central Bank | European Central Bank (ECB) |
| Chair title | President of the ECB |
|| Default prime rate | 3.0% |
| Stock exchange | DAX |
| Finance Minister | Chancellor of Finance (Finanzminister) |

---

## Key Germany links

- [Cabinet Guide](/wiki/cabinet-guide): every cabinet post, its metrics, and its actions
- [Election Mechanics](/wiki/election-mechanics): Primary and general election rules
- [Core Systems](/wiki/core-systems): Turn structure, action economy
- [Player Progression](/wiki/player-progression): Career ladder details
- [Campaign Strategy](/wiki/campaign-strategy): Fundraising, ads, canvassing

---

## Living history

The timeline below is written by the turn processor whenever a Chancellor transition or federal-scope bill enactment happens in-game. Each entry is a real event from this save.

\`\`\`country-history
DE
\`\`\`
`;

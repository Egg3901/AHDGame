export const tradeSystemContent = `# International Trade

The International Trade system is an inter-country trade clearing engine that computes **trade affinity** between every pair of countries each turn. Affinity determines how much trade flows between countries and is modified by free trade agreements, shared organization blocs, tariffs, and ministerial embargoes.

## Core concept: trade affinity

Every country pair has a **trade affinity** value that represents how much trade flows between them. Affinity starts at a **base of 1** and is then multiplied (or reduced) by several modifiers:

1. **FTA affinity bonus**: if the pair is covered by an active free trade agreement
2. **Bloc affinity bonus**: if both countries share membership in the same international organization
3. **Tariff drag**: a reduction based on the effective tariff rate between the pair
4. **Ministerial embargo**: a hard zero if one country has embargoed the other

The final affinity is the product of all applicable modifiers.

## Modifiers

### FTA affinity bonus

When two countries are covered by an **active free trade agreement** (passed through an [international organization](/wiki/international-organizations)), their trade affinity is multiplied by **1.6×**.

\`\`\`
affinity *= 1.6  // FTA active between the pair
\`\`\`

This is the single largest trade modifier in the system and makes FTAs the most impactful diplomatic tool for boosting bilateral trade.

### Bloc affinity bonus

When two countries **share membership in the same international organization**, their trade affinity is multiplied by **1.25×**.

\`\`\`
affinity *= 1.25  // both countries in the same org bloc
\`\`\`

This bonus stacks with the FTA bonus. Two countries that are both in the EU *and* have an active FTA receive a combined **1.6 × 1.25 = 2.0×** affinity multiplier.

### Tariff drag

Tariffs reduce trade affinity. The drag formula is:

\`\`\`
drag = 1 / (1 + 3 × tariffRate)
affinity *= drag
\`\`\`

At common tariff rates:

| Tariff Rate | Drag Multiplier | Affinity Change |
| --- | --- | --- |
| 0% | 1.000 | 0% (no drag) |
| 5% | 0.870 | -13.0% |
| 10% | 0.769 | -23.1% |
| 20% | 0.625 | -37.5% |
| 50% | 0.400 | -60.0% |
| 100% | 0.250 | -75.0% |

At a **20% tariff**, drag is approximately **0.625**, meaning trade affinity is reduced by **37.5%**. High tariffs make bilateral trade dramatically less efficient.

> **Note:** Tariff drag is computed from the effective tariff rate, which is the sum of all applicable tariff layers (economy-wide, sector, origin-country, corporation-specific). See [Tariffs](/wiki/tariffs) for how the effective rate is calculated. Active FTAs can override the effective rate to zero for covered partners, eliminating drag entirely.

### Ministerial embargo

A **ministerial embargo** is a hard block on trade between two countries. When active, trade affinity between the embargoing country and the target is set to **zero**: no trade flows regardless of other modifiers.

## IPF convergence

The trade clearing engine uses **iterative proportional fitting (IPF)**, a method that repeatedly adjusts trade numbers in small steps until every country's imports and exports line up, to balance trade flows across all country pairs. The engine runs **40 iterations**, which converges margins to below **0.5%**, meaning the result is effectively exact for gameplay purposes.

\`\`\`
IPF iterations: 40
Convergence threshold: < 0.5% margin
\`\`\`

This ensures that the affinity values produce a self-consistent trade matrix where every country's imports and exports balance correctly.

## Ministerial embargoes

Embargoes are the most aggressive trade tool available. They are issued by a cabinet minister and have strict limits:

| Parameter | Value |
| --- | --- |
| Cost | 1 cabinet action |
| Max duration | 96 turns (~2 game years) |
| Max active per member | 2 |
| Cooldown per source→target pair | 168 turns |

### Rules

- **Cost:** Each embargo consumes **1 cabinet action** to enact.
- **Duration:** An embargo lasts at most **96 turns** (approximately 2 game years), after which it expires automatically.
- **Concurrent limit:** A single member can have at most **2 active embargoes** at any time.
- **Cooldown:** The **168-turn** source-to-target cooldown starts when the embargo is enacted, not when it expires.

Because the maximum embargo lasts 96 turns, a full-duration embargo leaves at least 72 turns before that source can target the same country again.

## Affinity calculation summary

The full affinity calculation for a country pair:

\`\`\`
let affinity = 1;                          // base affinity

if (pair covered by active FTA) {
  affinity *= 1.6;                          // FTA bonus
}

if (both countries share an org bloc) {
  affinity *= 1.25;                         // bloc bonus
}

const drag = 1 / (1 + 3 × effectiveTariffRate);
affinity *= drag;                           // tariff drag

if (active embargo between the pair) {
  affinity = 0;                             // embargo zeroes trade
}
\`\`\`

## Example scenarios

| Scenario | FTA | Bloc | Tariff | Embargo | Final Affinity |
| --- | --- | --- | --- | --- | --- |
| Neutral, no tariff | No | No | 0% | No | 1.00 |
| Same bloc, no tariff | No | Yes | 0% | No | 1.25 |
| FTA, same bloc | Yes | Yes | 0% | No | 2.00 |
| 20% tariff, no FTA | No | No | 20% | No | 0.625 |
| FTA + 20% tariff on books | Yes | No | 20% (overridden to 0%) | No | 1.60 |
| Embargo active | n/a | n/a | n/a | Yes | 0.00 |

Note the FTA override: even though a 20% tariff is on the books, the FTA collapses the effective tariff to zero for covered partners, so the drag multiplier becomes 1.0 and the full 1.6× FTA bonus applies.

## Strategic notes

- **FTAs are the strongest trade lever.** A 1.6× multiplier dwarfs all other modifiers. Prioritize passing FTAs through [international organizations](/wiki/international-organizations) with your key trading partners.
- **Bloc membership is cheap affinity.** Simply being in the same org as a trading partner gives a 25% boost with no legislation required.
- **Tariffs and FTAs interact.** An FTA makes tariffs irrelevant for covered partners: they pay zero. Use FTAs to shield partners from your own tariff policy.
- **Embargoes are blunt and temporary.** They zero trade but expire after 96 turns and trigger a 168-turn cooldown. Use them for targeted pressure, not permanent isolation.
- **IPF convergence is exact at 40 iterations.** You can trust that the trade matrix is self-consistent: there are no "approximate" affinity values in the final result.

## Related systems

- **[International Organizations](/wiki/international-organizations)**: where FTAs and bloc memberships are established
- **[Tariffs](/wiki/tariffs)**: how tariff rates are set and how they stack
- **[National Budget](/wiki/national-budget)**: how tariff revenue feeds into government finances
- **[Corporations](/wiki/corporations)**: how trade affinity affects corporate sector margins
`;

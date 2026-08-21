export const householdEconomyContent = `# Household Demand & Price Level

Households are an active part of the commodity economy. In fresh worlds, the
household-consumption system replaces the older flat demographics demand uplift
with a population-based consumer basket that reacts to employment, income,
confidence, and prices.

## Household consumption

Every state generates demand for a basket of finished goods and consumer
services, including food, energy, retail, vehicles, electronics, medicine,
housing, finance, networks, entertainment, software, freight, and professional
services.

The total budget is anchored to population rather than nominal GDP so countries
with different currencies remain comparable. Three state signals then adjust
the demand level:

- Lower unemployment raises household demand; high unemployment reduces it.
- Consumer confidence moves demand within a bounded range.
- Median income is compared with the country average, not with another
  country's currency-denominated income.

Wealth changes the basket mix through Engel's law. Richer states spend a
smaller share on staples and a larger share on vehicles, electronics, housing,
finance, entertainment, and software.

## Price elasticity

Households buy less of a commodity when its prior global price rises above the
era base price and more when it falls below. Staples such as food, energy,
healthcare, and medicine are relatively inelastic. Vehicles, electronics,
software, and entertainment respond more strongly.

In plants worlds, household demand is scaled onto the physical production unit
basis. Per-commodity demand is capped at 1.5× the prior turn's global supply so a
tiny new market cannot receive impossible demand that no build-out could satisfy.

## Household price index

Each country also carries a household price index, starting at 1.0. Every turn
it compounds 75% of the country's annual inflation rate on a per-turn basis:

\`nextIndex = priorIndex * (1 + 0.75 * annualInflation / 100 / 48)\`

This is a price-level record, not a feedback input into inflation. The economy
panel uses it to convert nominal median income into launch-price purchasing
power. An index of 1.25 means the tracked household basket costs about 25% more
than at the world's starting baseline.

## What players should watch

- Consumer demand creates an end market for finished goods and services.
- Weak employment or confidence reduces that demand even if factories have
  ample capacity.
- High prices destroy some discretionary demand, while staples hold up better.
- Nominal income can rise while real household purchasing power falls if the
  price index rises faster.

See also: [Commodities](/wiki/commodities), [National Metrics](/wiki/national-metrics), [Corporations](/wiki/corporations), [Planned / Command Economies](/wiki/planned-economies)
`;

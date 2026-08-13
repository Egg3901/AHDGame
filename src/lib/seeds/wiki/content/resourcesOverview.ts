export const resourcesOverviewContent = `# Resources

States across all five countries hold deposits of natural resources that can be extracted by corporations. These resources feed the commodity market, affect corporate profit margins, and represent sovereign wealth that governments can choose to contract out or protect.

## The seven extractable resources

Seven resources can be extracted from state deposits. Each is measured in its own unit:

| Resource | Unit | Primary economic role |
| --- | --- | --- |
| Oil | barrels (bbl) | Energy sector input; chemical industries |
| Coal | tons | Energy and industrial input |
| Iron | tons | Industrial and construction input |
| Copper | tons | Technology and manufacturing input |
| Natural Gas | MMBtu | Energy sector input |
| Timber | cubic metres (m³) | Construction and paper input |
| Rare Earth | tons | Technology sector strategic input |

These seven are a subset of the eleven commodities tracked in the broader commodity pricing engine. Standard manufactured commodities (steel, electronics, consumer goods) have no extraction model: they come from corporate sectors processing other inputs, not from the ground.

## The capacity system

Every state that has natural resources holds a **resource capacity document** specifying the maximum extraction output (in commodity units) it can yield per turn. These figures are benchmarked to real-world production data.

For example, Texas holds a capacity of 450,000 bbl/turn of oil and 2,250,000 MMBtu/turn of natural gas. Alaska adds rare earth deposits. Wyoming is one of the few states with coal, oil, natural gas, timber, and rare earth all present.

A reference calculation: a ₳10M/day extraction corporation running at a 20% supply rate produces roughly:
- Oil: 25,000 bbl/turn
- Coal: 13,333 tons/turn
- Natural Gas: 48,000 MMBtu/turn
- Copper: 111 tons/turn (at a 10% rate)
- Timber: 2,000 m³/turn (at an 8% rate)

**States without a capacity document are treated as uncapped**: a backward-compatible default for any state not explicitly seeded with resource data. In practice, every major producing state has been seeded with real-world-derived capacity numbers.

### R&D can expand capacity

Extraction corporations with active R&D budgets can permanently increase a state's resource capacity through innovation breakthroughs. A breakthrough for an oil-and-gas corporation grows that state's oil and natural gas capacity; an iron mining breakthrough grows iron capacity only. This mechanic represents "unlocking new deposits" and means state capacities are not truly static over the game's lifetime.

### Prospecting: funding a geological survey

Prospecting is a deliberate, paid alternative to waiting on R&D breakthroughs. Any extraction corporation with a sector in a state, or that state's own government (national or state level), can commission a geological survey targeting one resource in one state. NPP miners do this too when the deposit is short and they can afford the survey.

A survey takes 12 turns to complete. The corporation launching a survey pays a starting cost of ₳500,000, which climbs the more that state and resource have already been successfully surveyed (up to 4x the base cost, capping how many times a deposit can be squeezed for new capacity). Government-funded surveys draw from the national treasury or the state budget instead of a corporation's cash.

Success odds and payout differ by who is funding the survey:

| Initiator | Success chance | Capacity gain on success |
| --- | --- | --- |
| Corporation | 25% to 80%, scaling with the corporation's R&D score | 3% to 16% of current capacity, scaling with R&D score |
| Government (national or state) | Flat 50% | 4.5% to 12% of current capacity |

Every survey is capped at adding no more than 20% of the resource's current capacity in a single roll, even at maximum R&D score. A corporation can run up to three active surveys at once; each government can also run up to three active surveys at once across the country.

A failed survey costs the money already paid and produces nothing. A successful survey immediately increases the state's capacity for that resource, available starting the next turn's commodity price calculation.

Prospecting and R&D breakthroughs stack: a corporation with a strong R&D program benefits from both a passive chance of a breakthrough each turn and much better prospecting odds when it chooses to commission a survey directly.

## How capacity affects corporate output

Capacity caps work as a **multiplier on extraction sector output**, not a hard cutoff:

- If a sector's computed output for a resource is below the state's capacity ceiling, it operates at full output (multiplier = 1.0).
- If demand from all extraction sectors in a state exceeds available capacity, output is proportionally squeezed.
- States with no capacity document produce without a cap (multiplier stays at 1.0 for all resources).

The result: resource-rich states support more extraction activity before running into diminishing returns, while resource-poor states effectively can't supply commodities they don't have in the ground.

## Contracted vs. open-access capacity

State resource capacity is divided between two pools:

**Contracted capacity** is reserved exclusively for a corporation holding an [extraction contract](/wiki/extraction-contracts). The corporation has guaranteed priority access to its contracted share of the state's ceiling.

**Open-access capacity** is the remainder: available to all extraction sectors in that state on a first-come, proportional basis. If total demand from uncontracted sectors exceeds the open pool, every uncontracted sector's output is squeezed proportionally.

When contracts add up past 100% of a state's capacity (an **over-allocated** state), the open-access pool collapses to zero. Uncontracted extraction sectors in an over-allocated state produce nothing for that resource.

## Which states have which resources

Major resource concentrations across the five countries:

**United States**: Texas leads in oil and natural gas. Pennsylvania and West Virginia are major gas and coal producers. Minnesota holds the largest iron deposits. Arizona is the copper hub. Wyoming and Alaska are uniquely diverse, holding five or more resource types each.

**United Kingdom**: Scotland holds the country's largest oil and gas deposits (North Sea). Wales, Yorkshire, and the East and West Midlands hold most of the UK's remaining coal and iron.

**Germany**: North Rhine-Westphalia dominates coal and iron production. Lower Saxony holds oil and natural gas. Bavaria and Rhineland-Palatinate hold rare earth deposits.

**Japan**: Hokkaido and Kyushu hold coal and timber. Chugoku and Tohoku hold rare earth and natural gas. Japan's overall resource base is modest compared to North American counterparts.

**Canada** (not currently in-game): reserved for future expansion.

## Why resources matter

Resources flow directly into the [commodity pricing engine](/wiki/commodities). When extraction output is high, commodity supply is abundant and prices fall, benefiting industrial sectors that use those commodities as inputs. When output is constrained (whether by capacity ceilings, lack of contracts, or over-allocation), supply tightens and commodity prices rise, squeezing margins for downstream sectors.

Legislators and corporations can influence resource flows through three tools:
- **[Extraction contracts](/wiki/extraction-contracts)**, granting exclusive capacity shares to specific corporations
- **Prospecting**, paying for a geological survey to grow a state's capacity for a resource
- **[Subsidies](/wiki/subsidies)**, providing margin bonuses that make extraction sectors more profitable regardless of commodity prices

For the corporate side of this system, see [Corporations](/wiki/corporations).
`;

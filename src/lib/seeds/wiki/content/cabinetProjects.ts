export const cabinetProjectsContent = `# Cabinet Projects & Buildings

If you hold a cabinet seat, you may see options to build things: schools, hospitals, embassies, power plants, highways. This page explains what those are, what they actually do, and how to use them well. It applies to every country whose cabinet has an authored portfolio: examples below use UK seat names.

## The short version

Cabinet buildings are **persistent assets** your seat owns. Each one sits in a specific region and gives that region a small, ongoing nudge to its metrics every turn (for example, a public school slowly raises education metrics in the region it sits in). Separately, the total upkeep of everything you have built is compared against your ministry's discretionary budget: build modestly and you help the national budget balance metric; overbuild and you drag it down.

They never spend real money out of the federal budget. Upkeep is *modeled pressure* on the budget balance metric, not an actual withdrawal.

There are three flavors, depending on which seat you hold:

| System | Who gets it (UK example) | Assets |
| --- | --- | --- |
| **Estates** | Most portfolio seats (Education, Health, Home, Justice, Foreign...) | Schools, hospitals, courts, embassies, jobs centres... |
| **Energy plants** | The energy-mapped seat (UK: Environment Secretary) | Coal, gas, nuclear, hydro, wind, solar plants |
| **Infrastructure projects** | The transport seat (UK: Transport Secretary) | Highways, transit, bridges, railways, broadband, freight, airports |

## Estates (most cabinet seats)

An **estate** is a facility or program tied to your portfolio: e.g. the Education Secretary can open public schools, the Health Secretary hospitals, the Foreign Secretary embassies abroad. Each portfolio has three archetypes to choose from.

Every estate has four things you control or watch:

- **Location**: chosen when you open it, then fixed forever. Domestic estates sit in one region and affect *that region's* metrics. Foreign-portfolio estates sit in another country and boost your own country's national soft-power metrics (they do not affect the host).
- **Tier** (Basic → Established → Expanded → Flagship): the **Expand** lever. Higher tier = stronger effects and higher upkeep (1x / 1.5x / 2x / 2.5x).
- **Funding** (Reduced / Standard / Enhanced): the **Fund** lever, free to change. Higher funding costs more upkeep but raises output and the condition your estate settles at.
- **Condition** (0-100): drifts a few points per turn toward your funding level's baseline (Reduced ~55, Standard ~75, Enhanced ~90). Effects scale with condition, so a neglected estate does proportionally less. Upkeep does NOT scale with condition: a run-down hospital still costs money.

**Actions:** Open and Expand each cost 1 ministerial action. Close and Fund are free. Actions are capped at 4 and regenerate 1 every 24 turns.

**Effect size:** each estate's per-turn effect is small (roughly the same scale as ministerial orders), scaled by tier x funding x condition. All cabinet effects on the same metric are capped per turn, so stacking has diminishing returns.

## Energy plants (energy seat)

The energy-mapped seat (UK: Environment Secretary, US: Secretary of Energy) builds **power plants**. Your plants in a region collectively form that region's generation mix, which nudges three regional metrics toward what the mix implies:

- **Renewable energy share**: driven by how much of your capacity is hydro/wind/solar.
- **Carbon emissions**: coal is worst (1.0 carbon per MW), gas half that, nuclear/renewables zero.
- **Power grid reliability**: rewards *firm* (always-on) capacity like coal/gas/nuclear/hydro and a *diverse* mix (up to 4 distinct sources counts).

These are "nudges toward a target": the further the region's metric is from what your mix implies, the harder it pulls, easing off as it converges. So a big nuclear build-out in a coal region shows visible movement for many turns, then settles.

Plants are built in a region (fixed), can be **upgraded** through 4 tiers (each tier raises capacity and upkeep), and **decommissioned**. Build and upgrade cost 1 ministerial action.

**The trade-off table:**

| Source | Renewable | Carbon | Firm? | Upkeep |
| --- | --- | --- | --- | --- |
| Coal | No | Worst | Yes | Mid |
| Gas | No | Medium | Yes | Low-mid |
| Nuclear | No | None | Yes | Highest |
| Hydro | Yes | None | Mostly | Lowest |
| Wind | Yes | None | No | Low |
| Solar | Yes | None | No | Lowest |

## Infrastructure projects (transport seat)

The transport seat (UK: Transport Secretary) starts **construction projects** that take several turns to build, then produce fixed ongoing effects once operational:

| Project | Build time | What it does when finished |
| --- | --- | --- |
| Highway | 6 turns | Road condition up, infrastructure investment gap down |
| Transit | 8 turns | Public transit up, investment gap down |
| Bridge | 4 turns | Road condition up |
| Railway | 9 turns | Transport efficiency up, investment gap down |
| Broadband | 5 turns | Broadband access up |
| Freight | 7 turns | Road condition up, GDP growth up |
| Airport | 7 turns | Public transit up, GDP growth up |

While building, you can set the **funding level**: Slowed (half speed, cheaper per turn), Standard, or Crashed (1.8x speed, much more expensive per turn). Once operational a project is permanent and pays only its (smaller) upkeep. Starting a project costs 1 ministerial action; changing funding or cancelling is free.

Unlike energy plants, infrastructure effects are flat standing bonuses: they do not fade as the region improves.

## The budget envelope: why you should not build everything

Each of these systems compares your total running costs against a **discretionary envelope**: a slice of the national budget your ministry is allowed to lean on (for transport, it is derived from the actual transportation appropriation, so a generous national budget genuinely lets you build more).

- Spend **under** the envelope: small positive tilt to the national **budget balance** metric each turn.
- Spend **over** it: the tilt goes negative, and it worsens the further over you are.

So the game is not "build maximum everything": it is picking the assets whose regional effects you actually want, in the regions that need them, while staying near your envelope.

## Practical tips

- **Put buildings where the problem is.** A school helps only the region it sits in. Check regional metrics first and site your assets in the weakest regions.
- **Condition lags funding.** After changing funding it takes several turns for condition (and thus effect strength) to settle. Enhanced funding is a long-term commitment, not a burst.
- **Ministerial actions are scarce** (max 4, slowly regenerating): Opens, Expands, plant builds, and project starts all compete with your ministerial orders for the same actions.
- **Crash-build only what matters.** Crashed funding nearly doubles build speed but almost doubles the per-turn construction cost pressure on your envelope.
- **Location is forever.** You cannot relocate an estate, plant, or project: close/decommission and rebuild instead.

## Related pages

- [Cabinet](/wiki/cabinet): appointments, ministerial orders, tier settings, and the action economy
- [National Metrics](/wiki/national-metrics): the metrics these assets move
- [National Budget](/wiki/national-budget): where the discretionary envelopes come from
- [Government Formation](/wiki/government-formation): how parliamentary cabinets (UK/JP/DE) are appointed
`;

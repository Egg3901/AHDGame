export const labourAndWagesContent = `# Labour & Wages

The labour system makes worker pay an explicit sector cost. CEOs set a **wage level** per sector; national **minimum-wage** legislation can floor low-pay jobs; and wage choices feed back into unemployment, migration, and median income. At baseline settings the economy matches pre-labour outcomes; only deviations from the default move the needle.

## Wage level

Every corporate sector has a **wage level** slider (default **1.0**). The CEO adjusts it from the sector detail panel when wages are enabled.

- **1.0**: baseline pay; total sector maintenance (including labour) matches the pre-labour economy.
- **Above 1.0**: higher wages raise labour costs and can pull workers in; real wages rise relative to local cost of living.
- **Below 1.0**: cheaper labour improves margins but can weaken worker satisfaction and macro outcomes over time.

Labour is carved out of existing sector maintenance rather than stacked on top, so flipping the system on at default settings does not instantly reshuffle profits.

## How labour cost is computed

Each sector decomposes labour into **workers × wage-per-worker**:

- High-skill sectors (technology, financial) employ fewer workers at a higher implied wage per worker.
- Low-skill sectors (retail, agriculture) employ many workers at lower per-worker pay.

The wage slider scales the wage-per-worker term. **Minimum-wage** legislation floors that term using a **Kaitz ratio** (minimum wage ÷ median wage) per country. Weak protection raises unionization pressure later; strong protection lifts pay in low-wage sectors.

## Minimum wage

Countries enact minimum-wage policy through legislation. The active option sets a Kaitz ratio that floors wage-per-worker in sectors that would otherwise pay below the floor.

When macro labour effects are enabled, minimum-wage changes also feed the national wage index and unemployment channels alongside CEO wage choices.

## Macro feedback (wages to economy)

When the labour system runs at **macro** tier or above, wage dynamics connect to national metrics:

| Channel | Effect |
| --- | --- |
| **Median income** | Tracks the labour wage index: higher economy-wide wages lift median income over time. |
| **Unemployment** | High wages relative to productivity can add wage-push unemployment; automation and sector mix also matter. |
| **Migration** | Real wage gaps between regions/countries influence migration pull on population metrics. |

These links are lagged and damped; they reward sustained wage strategy, not one-turn slider spikes.

## CEO tools

From a sector's detail view (when wages are enabled):

- Set **wage level**: immediate input to next turn's labour cost and real-wage index.
- Read **implied wage vs. state median**: contextualizes whether you are paying above or below the local economy.

Wage spending flows through the same profit pipeline as other sector costs and affects corporate margins directly.

## Phased rollout

Labour ships in tiers:

| Tier | What unlocks |
| --- | --- |
| **wages** | Explicit labour cost, wage slider, minimum-wage floor |
| **macro** | Wage index → median income, unemployment, migration |
| **unions** | Sector unionization drift, standing premium, strikes: see [Unions](/wiki/unions) |
| **full** | Union-law bias, union-busting, player-run unions |

Fresh worlds start at **full**, so all four layers are active. Admins can dial a particular world down to an earlier tier for rollout or testing.

## Related

- [Corporations](/wiki/corporations): sector costs, margins, and CEO tools
- [Unions](/wiki/unions): unionization, strikes, and player-run unions (phased)
- [National Metrics](/wiki/national-metrics): unemployment, median income, migration
- [Bills & Legislation](/wiki/bills-legislation): minimum-wage and union-law provisions
`;

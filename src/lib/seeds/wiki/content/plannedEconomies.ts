export const plannedEconomiesContent = `# Planned / Command Economies

Most countries in A House Divided are market economies: floating currencies, a central-bank chair setting rates, and commodity prices that clear on supply and demand. **Planned (command) economies are a different model, and now a played one.** In a command country you run the state industries, allocate the national plan, and direct state credit. Whether the country stays communist or reforms toward the market is decided by how well the plan is run, not by a script.

**This is not a bug.** If a Soviet-era ruble never drifts, national commodity prices ignore supply and demand, or a state firm stays alive while insolvent, you are looking at planned-economy rules. See [Commodities](/wiki/commodities) and [Currency Exchange](/wiki/currency-exchange) for the market path; this page is the planned path.

Fresh worlds enable the regime. Countries that start on the command end of the dial (USSR/Russia, China in its early eras, Eastern-bloc satellites) come up as planned economies with their state industries split into separate enterprises you can run. Admins can disable the command-economy layer for a particular world.

## How a country becomes a command economy

Two gates must both be true:

1. The world-level command-economy feature is enabled. Fresh-world seed data enables it by default; an admin can change the world setting.
2. The country's **marketization level** is below the market ceiling. The era only sets the *starting* value. From there the level moves on its own each turn based on what happens in the economy (see The Marketization Dial Is Earned below).

| Band | Dial | What you get |
| --- | --- | --- |
| Fully command | below 30 | Fixed currency, passive bank, administered CPI, soft budgets, full planned pricing |
| Dual-track | 30 to under 70 | Plan and market run together; national prices and shortage pressure scale with how much is still planned |
| Market | 70+ | Standard floating FX, chair policy, supply-and-demand commodity pricing |

Soviet Russia and early China start fully command; Eastern-bloc countries start command; China starts further along the dial in later eras. Where each ends up is now up to how the country is governed.

## State-owned enterprises (SOEs)

Instead of one national conglomerate, a command country's commanding heights are split into **separate state enterprises, one per strategic sector** (heavy industry, energy, extraction, agriculture, consumer goods, defense, chemicals, transport; the exact set is country and era specific). Each SOE carries its own:

- **Plan target**: the output quota it is expected to hit.
- **Output**: what it actually produced this turn.
- **Plan fulfillment**: output divided by target. This is the score the enterprise is judged on.
- **Capacity**: how much the enterprise *could* produce if it ran flat out.
- **Efficiency**: this is **capacity utilisation**, output divided by capacity. It is *not* cost per unit. Efficiency under 50% means the enterprise is only using half the capacity it owns; efficiency over 100% means it is running above nameplate. Idle capacity still costs upkeep every turn, so low efficiency is a bill, not just a low score.
- **Cumulative losses**: the running tally of missed plan (the soft-budget bill).

When lots of SOEs beat their targets, the plan is working and the command model holds. When they chronically miss, shortages build and pressure to reform the whole system grows.

## The three seats

A command economy is run through three offices. Each is filled by the government (cabinet or Supreme Soviet). If a seat is empty, the state brain runs it competently by default, so single-player worlds still work. A human who claims a seat takes over from the brain.

### SOE Director (the industrialist)

One director seat per strategic SOE. The director runs a single enterprise and chooses:

- **Production target**: play it safe or stretch for a higher quota.
- **Investment request**: ask the Gosbank Chair for capital to expand.
- **Labor vs quality**: one slider, not two levers. Push it toward **quality** and the efficiency trend slowly climbs; push it toward **raw output** and the efficiency trend slowly drags down. It is a small nudge each turn (efficiency is mostly set by how well capacity is used, below), so treat it as a long-run lean: quality on the enterprises you are building up, raw output to squeeze the ones already running flat out.

Hit your targets and your enterprise grows and your political standing rises. Miss them and you feed the shortages that erode the whole command system.

### Reading efficiency and where investment goes

Because efficiency is capacity utilisation, investment (new capacity from the Gosbank) does the opposite of what it looks like on a *low*-efficiency enterprise: adding capacity to a factory that is only half used pushes utilisation down further and adds more upkeep for capacity nobody is producing with. The rule of thumb:

- **Invest where efficiency is high** (near or above 100%). These enterprises are capacity-constrained with real demand behind them, so more capacity turns into more output.
- **Where efficiency is low** (well under 50%), do **not** pour in capacity. Either lean the labor/quality slider toward raw output to use the capacity already there, or **close** capacity to stop the upkeep bleed. An enterprise sized far above its demand is a loss machine, and the fix is to shrink it, not fund it.

### Gosplan Central Planner (the macro)

The planner sets the **national plan**: the output quotas and the investment split across every sector. This is the heavy-industry-versus-consumer-goods balancing act. Over-ambitious targets look strong on paper but widen the gap between plan and reality, which shows up as shortage. Under-ambitious targets leave growth on the table.

### Gosbank Chair (the kingmaker)

The Gosbank Chair runs **state credit**. Each turn the bank lends a credit budget across the SOEs, and the chair decides:

- **Which sectors get the money**: pick winners with an explicit per-sector allocation, or let the bank steer credit toward the enterprises that are missing plan.
- **How aggressively to fund**: a restrained credit posture or a flood.
- **Budget softness**: bail out insolvent SOEs and keep them running (soft), or let the weak ones fold to force efficiency (hard).

## Directed credit and its cost

Directed credit is the Gosbank Chair's main lever, and it is a genuine tradeoff.

- **The upside**: credit builds an SOE's capacity and lifts its output over the following turns. Fund the right sectors and you hit the plan and hold the economy together.
- **The cost**: the part of that credit not backed by real household savings is **printed money**. It piles up as monetary overhang, which drives shortage. Fund everyone generously and you empty the shelves.

That is the Gosbank tightrope. You can grow industry with cheap credit, but the more you print the worse the shortages get, and shortages are one of the forces that push the country toward the market. You have to choose favorites.

## The marketization dial is earned

The single most important change: **marketization is no longer scripted.** The era sets the starting level, then it drifts every turn based on three live drivers.

| Driver | Pushes toward market when... |
| --- | --- |
| Black-market pressure | Shortages, the shadow premium (the markup black-market goods sell at over the official price), and the second economy are large |
| SOE performance | The state enterprises are chronically missing their plan |
| Policy stance | The elected government and the Gosbank lean reformist (market-leaning ruling party, disciplined credit, hard budgets) |

There **is a weak era gravity**: a small restoring pull toward the historical schedule for that turn, on top of the three free drivers above. It is deliberately capped below what the free drivers can sustain, so it nudges rather than dictates. History can still break: a well-run orthodox USSR can stay red long past 1991, and a badly mismanaged one reforms toward the market and, eventually, out of communism. A hardline government with a disciplined plan can hold command indefinitely against gravity; a reformist government that lets the enterprises fail will marketize faster than the schedule alone would predict.

**Government reformism is live.** The ruling party's economic position feeds the policy driver directly. Win an election with a market-leaning party, or shift the ruling party's economic stance through gameplay, and marketization responds. This works whether the government is player-led or run by the state brain.

## The feedback loops (the fun)

- **Reform spiral**: underfund the SOEs, they miss plan, shortages grow, the black market swells, marketization rises, market rules creep in, and eventually the command economy unwinds. A mismanaged state collapses early.
- **Stable orthodoxy**: fund the right sectors, hit the targets, keep the black market contained, and the dial holds. The country stays command for as long as you run it well.
- **Gosbank tightrope**: print to grow output, but watch overhang and shortage climb with it. Growth and empty shelves are two sides of the same lever.

## Repression: holding the line

Reform is not the only answer to a swelling black market. A hardline government can crack down instead. The Gosbank Chair or head of government can set an **internal repression** level that forces the second economy down, hides the grey market, and slows the drift toward the market.

What repression does **not** do is fix the shortage. The shelves are still empty; you have only pushed the trading underground. And it is not free: cracking down costs regime legitimacy every turn, and the bill grows the harder you push amid scarcity. Heavy repression sitting on top of a deep shortage is a pressure cooker that bleeds legitimacy while the underlying problem festers.

That is the hardliner tradeoff. Repression buys time against reform and keeps the country command for longer, but it treats the symptom, not the disease. Deliver the goods and it stays cheap; repress amid empty shelves and it becomes expensive fast. Reform or repress, either way the shortage still has to be answered.

## What the old rules still mean

The planned machinery from the passive model still applies while a country sits in the command or dual-track bands.

- **Two-circuit wage fund**: planned share pulls nominal wage growth down toward real-goods growth plus 2 percentage points. It never raises wage growth. This is the primary brake on forced saving when wages outrun consumer goods.

- **Fixed official currency**: in a fully command country the official rate is pinned to its era anchor and does not float. Do not build forex strategies around it the way you would around USD, GBP, or JPY.
- **The iron curtain**: in the Cold War eras the bloc's trade with the open world is closed in both directions, while the bloc's internal market and the open world each trade freely among themselves. Yugoslavia, which broke with Moscow before the era begins, sits outside the curtain and trades with the West even though its domestic economy stays planned. See [International Trade](/wiki/trade-system).
- **Passive central bank**: fully command economies run a passive monobank. The automatic rate setter does not fire, so do not expect rate hikes and cuts to chase inflation and growth.
- **Administered prices and CPI**: national prices are set by the plan, not cleared by supply and demand, and open inflation sits on the era path. Shortage shows up as unmet demand at a held price, not as a price spike.
- **Soft budgets**: state firms are not dissolved for insolvency the way market corporations are, unless the Gosbank Chair runs hard budgets. Zombie enterprises are the regime, not a stuck job.
- **Monetary overhang, shortage, black market**: when money outruns real goods, the excess becomes forced savings that feed a shortage index and a black-market premium. Read these instead of waiting for prices to clear.
- **The second economy**: repressed demand spills into an informal economy whose size tracks shortage and how far the state tolerates it. A tolerated grey market absorbs overhang and narrows the shadow premium.

## Dual-track transition

Dual-track means plan and market run in parallel: a share of pricing and shortage machinery stays planned, the rest clears like a market. As the marketization level climbs through the 30-to-70 band, more of the economy behaves like a market and the planned machinery fades. When a country crosses out of the planned bands entirely, floating FX, chair policy, supply-and-demand pricing, and normal insolvency rules return.

## What you can do

**As a player:**

- Claim an SOE Director seat and drive one enterprise's targets, investment, and labor-versus-quality mix.
- As Gosplan Central Planner, set the national quotas and the investment split across sectors.
- As Gosbank Chair, direct credit to the sectors you want to grow and set how soft the budgets are, knowing the shortage cost of printing.
- As a hardliner, set internal repression to force the black market down and resist reform, weighing the legitimacy it costs against the shortage it leaves untouched.
- Read shortage, overhang, and the black-market premium as your early-warning signals, and remember marketization now moves with them.
- Change the country's direction through elections and party positioning: a reformist government marketizes, an orthodox one entrenches.

**What you cannot do:**

- Turn the regime on or off (admin only).
- Set the world-wide second-economy tolerance (admin only).
- Rewrite the era starting level; only the *starting* value is era-authored, and everything after that is earned.

Open a country's live control room at **Country > Command Economy**, for example the [Soviet command-economy dashboard](/country/ru/command-economy).

See also: [Commodities](/wiki/commodities), [Currency Exchange](/wiki/currency-exchange), [Central Banks](/wiki/central-banks), [National Metrics](/wiki/national-metrics), [Market System: A Player's Guide](/wiki/market-system-guide).
`;

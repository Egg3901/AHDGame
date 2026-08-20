export const marketSystemGuideContent = `# Market System: A Player's Guide

This is a plain-language guide to the **market system**: the set of rules that decide how much money your corporations actually make from what they produce. It builds on the raw [Commodities](/wiki/commodities) market, and it's what ties your day-to-day pricing and investment decisions to your [share price](/wiki/stock-market).

If you just want the formulas and constants, the [Commodities reference](/wiki/commodities#market-tiers-clearing-and-capital) has them. This page is the *why* and the *what do I do*.

## The big idea

Older versions of the game paid your corporation a revenue number based mostly on market share and margins. The market system makes that revenue **earned**: prices react to scarcity, your goods have to find real buyers, and the capacity you build is a durable asset that shows up in your valuation.

It rolls out in **tiers**, switched on as a game world matures. Each tier that turns on adds one more layer of realism, and usually one more panel on your sector's detail page.

| Tier | What it does | What you see |
| --- | --- | --- |
| **Off** | Legacy behaviour: revenue from share and margins. | Nothing new. |
| **Realization** | Scarce goods pay a top-line premium; gluts bleed revenue. | Higher/lower sector revenue as prices move. |
| **Ledger** | Book-keeping groundwork for the tiers below (no new player action). | Mostly behind the scenes. |
| **Clearing** | Your output must actually sell: cheapest sellers clear first. | A **&ldquo;% sold last turn&rdquo;** badge and **pricing posture** buttons. |
| **Capital** | Your growth budget builds owned **capacity**; output is gated by it. | A **Capital panel** with a per-unit economics breakdown. |
| **Plants** | Your sectors **are** their plants. Revenue is derived from what those plants make and sell, and the nameplate stops growing on its own. | Build orders and a capacity figure that only moves when you build. |

You don't turn these on, the game does. Your job is to understand each one so you can price and invest well when it's active.

## Prices come from supply and demand

Every commodity has a price that moves each turn based on how much of it corporations produce (supply) versus how much they consume (demand). Scarcity pushes prices up; a glut pushes them down. The full mechanic (the 28 commodities, the curves, the three-tier blend) lives in [Commodities](/wiki/commodities). Copper is merged into rare earth; it is not a separate commodity. The market system is what turns those prices into your revenue.

## Price realization: scarcity pays, gluts hurt

The first economic tier is **price realization**. Instead of only nudging your margin percentage, commodity prices now **scale your top-line revenue**:

\`\`\`
factor = clamp((price / basePrice) ^ 0.5, 0.7, 1.5)
realizedRevenue = baseRevenue × factor
\`\`\`

| Market condition | Realization factor |
| --- | --- |
| Balanced (price = base) | 1.0× |
| Mild shortage (2× price) | ~1.41× |
| Big shortage | up to 1.5× (capped) |
| Oversupply (0.5× price) | ~0.71× |
| Deep glut | down to 0.7× (floored) |

It's **bounded and damped** on purpose: realization alone moves your revenue at most **-30% / +50%** in a turn, and it uses last turn's prices so it can't oscillate wildly. The takeaway: **producing something scarce is now genuinely rewarding**, and dumping into a glut genuinely hurts. See [Price Realization](/wiki/commodities#price-realization) for the details.

## Clearing: your goods have to actually sell

Once **clearing** is on, revenue is no longer handed to you: your output competes for real buyers. Each turn, demand fills the **cheapest sellers first**. Your realized revenue scales with the fraction of your output that actually sold (your **&ldquo;% sold last turn&rdquo;**).

This makes your **pricing posture** a real decision:

| Posture | What it does | Good when |
| --- | --- | --- |
| **Undercut** | Price below the market to clear ahead of rivals. | You want to sell out; there's a glut. |
| **At-market** | Price at the going rate. | You're unsure; balanced conditions. |
| **Premium** | Skim for margin, accept the risk of unsold stock. | Genuine shortage: everyone sells out anyway. |

In a shortage, everyone sells out and premium pricing pays. In a glut, the undercutters clear and the skimmers are left holding unsold output, which drags down their revenue, valuation, and share price.

\`\`\`clearing-posture
\`\`\`

There's also a physical limit: **input throughput can gate output**. If you can't get enough of the inputs your sector consumes, you physically can't produce (and therefore can't sell) at full tilt, no matter how you price.

![The sector-page Pricing panel showing the % sold badge and the undercut / at-market / premium posture buttons](/images/wiki/market/pricing-panel.png)

*(screenshot from the live Pricing panel)*

![The Commodities / throughput panel showing input availability gating output](/images/wiki/market/throughput-panel.png)

*(screenshot from the live Commodities / throughput panel)*

## Capital: capacity you own and maintain

Under the **capital** tier, your **growth budget becomes investment**. That investment builds productive **capacity**: a durable asset your company owns. The loop:

\`\`\`capital-loop
\`\`\`

Three things to internalise:

- **Capacity gates output.** You can only produce (and sell) up to what your capacity supports. Want more output? Invest to build more capacity.
- **Depreciation erodes idle capacity.** Capacity depreciates slowly every turn. A sector that stops investing gradually loses capacity, so reinvestment isn't optional if you want to hold your position.
- **Unit economics are visible.** The sector page shows a full per-unit breakdown, **price - labour - inputs - capital charge = unit profit**, so you can see the true economics of each unit, including the cost of the capacity it was built on.

![The Capital panel showing capacity, depreciation, and the per-unit price minus labour minus inputs minus capital-charge breakdown](/images/wiki/market/capital-panel.png)

*(screenshot from the live Capital panel)*

## Plants: your sectors are their plants

The **plants** tier is the end of the road, and it closes the last gap between what you own and what you earn. Under capital, capacity gated your output but a sector still carried a nameplate revenue number that grew on its own. Under plants that number is **derived**: it is the capacity you own, priced at what your output mix sells for. Nothing else feeds it.

Three consequences follow, and they change how you play:

- **Output grows only when capacity does.** There is no passive revenue drift to lean on. If you want a bigger sector next year, you have to commission plant this year and wait for it to arrive.
- **Entering a market is a build.** Founding a sector charges an era-scaled entry fee *and* a starter build of one facility, and that facility sits in a build queue before it produces anything. A brand-new sector earns nothing on its first turn.
- **Taking share moves plant.** Splits and attacks no longer shuffle a revenue number around: they transfer real capacity units. Both are priced with a floor at build cost plus a premium, so capturing capacity is never cheaper than building it, and an attack **destroys** part of what it takes. See [Corporations](/wiki/corporations) for the capture and attack formulas.

The practical upshot: growth is slower, more deliberate and more defensible than it was under the older tiers. A rival cannot conjure a sector overnight, and neither can you.

## What this does to your valuation

Because capacity is a **real, owned asset**, your company is valued for the durable capacity it owns, not just this turn's earnings. Valuation leans on **tangible book** (your liquid capital + sector value + an owned-capacity floor) weighted *above* raw earnings power.

That capacity floor is a **depreciated high-water mark** on the sector's going-concern value: it's seeded at the moment a tier flips (so it changes nothing at first) and only decays slowly if the sector is genuinely impaired. The practical effect: **a company holds its value through a transient profit dip**, because the assets it owns are still worth something even in a bad quarter. Your share price reflects **owned assets + earnings power**, not a single turn's profit. More on how shares are priced in [Stock Market](/wiki/stock-market).

## The transition is gentle: don't panic

When a new tier is switched on, **nothing changes on the first turn**. The flip turn itself is a no-op. From there the new mechanics **fade in gradually over roughly 240 turns**, so valuations *drift* rather than *lurch*.

This is deliberate. You get time to adapt your pricing posture and investment level as the new rules take hold. There's no overnight shock to your corporation or the market. If you see a tier go live, you don't need to do anything immediately; just start reading the new panels and adjusting over the coming turns.

## What to actually do

1. **Chase scarce commodities.** Realization and clearing both reward producing what's in short supply. Watch the [Commodities](/wiki/commodities) prices and shift toward tight markets.
2. **Set your posture to your goal.** Want volume and market share? Undercut. Want margin in a genuine shortage? Go premium. Check your **% sold last turn** each turn and adjust: unsold stock is lost revenue.
3. **Keep investing to hold capacity.** From capital onward an idle sector shrinks. Keep the growth budget high enough to at least offset depreciation, more if you want to grow output. Under plants this is the *only* way output grows, so a sector you stop funding is a sector you are slowly closing.
4. **Plan your builds ahead.** Capacity arrives on a delay, so the plant you order now is the output you get later. Decide where you want to be several turns out rather than reacting to this turn's prices.
5. **Read the sector panels.** The Pricing panel, the throughput/Commodities panel, and the Capital panel each tell you why your revenue is what it is. They're your dashboard.
6. **Think in assets, not just this turn.** A dip in profit isn't a collapse if you own real capacity, and rivals who stop investing are quietly getting weaker.

## Related systems

- [Commodities](/wiki/commodities): the 28-commodity market, prices, and the [market-tiers reference](/wiki/commodities#market-tiers-clearing-and-capital)
- [Stock Market](/wiki/stock-market): how owned assets and earnings power set your share price
- [Corporations](/wiki/corporations): founding and running sectors, strategies, and margins
- [Corporate R&D & Tech Trees](/wiki/corporate-r-and-d): unlocks that shift your cost and output curves
`;

import {
  CAPACITY_BUILD_TURNS,
  CAPACITY_SECTOR_TYPES,
  CAPACITY_BUILD_CANCEL_REFUND,
  IDLE_UPKEEP_FRACTION,
  MOTHBALL_UPKEEP_FRACTION,
} from "@/lib/constants/capacityEconomy";
import {
  CORPORATION_TYPE_LABELS,
  DOMINANCE_MARKET_SHARE_THRESHOLD,
  DOMINANCE_NATIONAL_SHARE_THRESHOLD,
  DOMINANCE_GROWTH_COST_MULT_AT_FULL,
} from "@/lib/constants/corporations";
import {
  MAX_BOND_ISSUANCE_FRACTION,
  MAX_BOND_ISSUANCE_EXIT_EQUITY_FRACTION,
  MAX_BOND_ISSUANCE_REVENUE_FRACTION,
  BOND_ISSUANCE_COOLDOWN_TURNS,
  BOND_ISSUANCE_COOLDOWN_TURNS_PRIVATE,
  CORPORATE_BOND_SPREAD_PREMIUM,
} from "@/lib/constants/bonds";
import {
  INVENTORY_CARRY_COST_RATE_PER_TURN,
  INVENTORY_DRAIN_RATE_PER_TURN,
  INVENTORY_SELL_DOWN_MIN_FILL,
} from "@/lib/corporations/sectorInventory";
import { STRANDED_WARN_TURNS } from "@/lib/corporations/strandedPlant";

/**
 * Running a Corporation under the Plants System. Code-backed wiki page: every
 * quoted number is interpolated from the live constants so the page never
 * rots when the economy is retuned. Screenshots live under
 * public/static/wiki/plants-corp-guide/ and are referenced by absolute path,
 * which the wiki markdown renderer allows (same-origin absolute image src).
 */

const pct = (f: number) => `${Math.round(f * 100)}%`;

/** Build-time table, slowest first, from the live constants. */
const buildTurnsTable = [...CAPACITY_SECTOR_TYPES]
  .sort((a, b) => CAPACITY_BUILD_TURNS(b) - CAPACITY_BUILD_TURNS(a))
  .map((t) => `| ${CORPORATION_TYPE_LABELS[t]} | ${CAPACITY_BUILD_TURNS(t)} |`)
  .join("\n");

export const plantsCorpGuideContent = `# Running a Corporation under the Plants System

Your corporation no longer grows by moving a slider. Each sector now owns real productive capacity, its plants, measured in units of output per day. You pay cash to build capacity, workers staff it, it takes real time to arrive, and the market only pays you for the units that actually sell. This guide walks through founding a corporation, building plants, reading the numbers the sector page shows you, and acting on them.

## The one paragraph version

Plants make units. The market buys the smaller of what is offered and what buyers want. Units that do not sell earn nothing but still cost you money to make. So the whole game of running a corporation is: build capacity where buyers still have room, price so your output sells, and stop paying for capacity the market does not want, by mothballing it or not building it in the first place.

## Founding a corporation

Open the Stock Market page (World menu, or the Corporations link) and press **Found Corp**.

![The global stock market page, with the Found Corp button top right](/static/wiki/plants-corp-guide/stock-market.png)

The founding dialog asks for a name, a ticker, and a primary sector. You choose between a **private** company, where you own 100% and your books are hidden from everyone else, and a **public IPO**, where shares trade on the exchange. A flat founding fee is deducted from your personal funds, the exact price is shown in the dialog, and headquarters is set to your home state.

![The Found a Corporation dialog](/static/wiki/plants-corp-guide/found-corporation.png)

Two things matter here:

- **Sector match bonus.** Sectors matching your corporation type earn a margin bonus, mismatched sectors take a penalty. The secondary sector gives a half strength bonus in exchange for a bigger sprawl penalty, and changing it later costs a cooldown and a temporary margin penalty on every sector.
- **The starter plant is a build, not a grant.** Founding a sector orders its starting capacity as a real construction project at a deep founding discount. The capacity arrives in slices, one per turn, across the build window. While the build is under way the sector produces little and earns little. That is normal, not broken. Revenue starts as the capacity lands.

The same applies when an existing corporation opens a sector in a new state or industry through **Expand**: you are buying a starter plant, and it ramps in over the build window.

## Your plants: capacity, fill, and the sector list

The corporation page's Operations tab lists every sector with its capacity (units per day), how full it is running, revenue, profit, and margin.

![A corporation's Owned Sectors table with capacity, fill, revenue, profit and margin per sector](/static/wiki/plants-corp-guide/sector-rows.png)

The margin shown here leads with the **fill adjusted margin**: realized profit over the cost of everything you produced, including the units that did not sell. A sector can have a great margin on the units it sells and still lose money overall because half its output goes unsold. The fill adjusted number is the honest one, which is why it comes first.

## Reading the sector page: the three numbers

Open any sector you own and the **Market and money** panel leads with three numbers before anything else:

1. **Selling.** The share of your output that buyers actually take, with a per product breakdown in the tooltip. Below 50% it turns amber: the market does not want that much of what you make.
2. **Per unit made.** What a unit coming off the line earned, counting unsold units as earning nothing, against what it cost to make, counting materials, wages, upkeep on idle capacity and overheads. If earns is below costs, every unit you produce loses money at today's fills.
3. **Break even.** How the cash already sunk into construction relates to what the sector clears. A turn count means profit at today's rate pays that spend back in that many turns. "Profitable now" means there is nothing left to pay back. "Not at current fills" means the sector does not clear a profit at today's sales, so more capacity will not fix it, more sales will.

Below the headline the panel shows the full chain with nothing skipped: units offered, sold and unsold, then revenue minus every physical cost line down to profit. The lines always add up exactly to the profit the turn booked.

Everyone else sees much less. Rivals viewing your sector get market share and the market pie, and nothing else:

![What a rival sees on your sector page: market share and the pie stay public, money is owner only](/static/wiki/plants-corp-guide/sector-market-position.png)

The **Market & supply** tab traces the same market from the outside: your share, your competitors, and the size of the unowned pool.

![The Market and supply chain view of a sector's market](/static/wiki/plants-corp-guide/market-supply-chain.png)

## Why output goes unsold

Markets clear the smaller of supply and demand. If everyone's plants together offer more units than buyers want, the extra units simply do not sell, no matter whose they are. Your share of the sales is then fought over on price: cheaper sellers clear first, and extra sales have to be won from rivals rather than found in new demand.

You can see this from the commodity pages. Here is a heavily oversupplied market:

![A commodity page showing a market where supply far exceeds demand and most output goes unsold](/static/wiki/plants-corp-guide/commodity-oversupply.png)

The supply and demand balance bar, the unsold count in Market flows, and the price sitting far below base all say the same thing: do not build here. Compare a tighter market before committing capacity:

![A second commodity market, also oversupplied but less severely](/static/wiki/plants-corp-guide/commodity-vehicles.png)

Three practical rules fall out of this:

- **A low selling share is a demand problem, not a production problem.** Producing more into a glut just raises your costs.
- **Price is your share weapon.** In an oversupplied market, lowering your price wins sales from rivals. It does not create new demand.
- **Watch the unowned pool.** Much of many markets is served by no player corporation at all. That revenue is claimable, but only up to what buyers actually spend.

After ${STRANDED_WARN_TURNS} consecutive turns below half sold, the sector page shows a stranded-plant warning. The warning does not close or change a player-owned plant. It explains the condition and points the CEO to growth, mothball, sale, and abandonment controls.

## Keeping unsold goods as inventory

The **Unsold output** panel on a sector page lets its CEO keep storable goods instead of discarding them at the end of the turn. This is off by default and does not apply to services.

Inventory is not free:

- It loses the commodity's normal spoilage each turn.
- It costs ${pct(INVENTORY_CARRY_COST_RATE_PER_TURN)} of its current value per turn to hold.
- It starts selling only when at least ${pct(INVENTORY_SELL_DOWN_MIN_FILL)} of fresh output clears.
- At most ${pct(INVENTORY_DRAIN_RATE_PER_TURN)} of the stored pile sells in one turn.

Turning stockpiling off stops new inventory from being added. It does not delete what is already stored; the existing pile continues to spoil, cost money, and sell down. Use inventory when a temporary glut is likely to clear. Mothball or reduce capacity when the market is structurally oversupplied.

## Building more capacity

The **Build capacity** dialog on the sector page prices an order, shows how long it takes, and tells you how much room buyers actually have, the smaller of the unowned market you could claim and the unmet demand left in the market. If you order more than that, the dialog warns you: the extra units will arrive with nobody to buy them.

Build times are per industry. Heavy, sited, permit bound industry is slow; asset light business is fast. For scale, 24 turns is one financial day and 48 turns is one game year:

| Sector | Build time (turns) |
|---|---|
${buildTurnsTable}

What you should know about orders:

- **Delivery is gradual.** Capacity arrives in equal slices every turn across the build window, and the build queue shows units delivered so far, the slice arriving per turn, and the finish turn. Revenue from the new capacity starts as soon as slices land, not at the end.
- **Cancelling costs you.** Cancelling an unfinished order refunds ${pct(CAPACITY_BUILD_CANCEL_REFUND)} of what you paid. The rest is gone, siting and engineering work you cannot unspend.
- **Price varies by place and situation.** The same plant costs more in an expensive state and less in a cheap one, more when your central bank's prime rate is high, less with a business savvy CEO and with cost reducing technology. The dialog itemizes every multiplier so you can see why an order costs what it does.

## Managing costs: idle plants and mothballing

Capacity you own but do not use is not free. An idle plant still carries about ${pct(IDLE_UPKEEP_FRACTION)} of the maintenance a running one costs: the site, upkeep against decay, a skeleton crew. The sector page's "Upkeep on idle plants" cost line shows exactly what this is costing you.

When a sector's market has collapsed you have three options, in rising order of severity:

1. **Run lean.** Keep producing at whatever share sells. Right when the market is merely soft and you expect it back.
2. **Mothball.** A mothballed sector produces nothing, offers nothing, and pays only ${pct(MOTHBALL_UPKEEP_FRACTION)} of full running maintenance, a large saving over holding plants idle but ready. Right when the glut is deep and you want to keep the capacity for later without bleeding cash every turn. Reactivate when the market recovers.
3. **Sell or abandon.** If the market is never coming back, capacity tied up there is dead capital. Selling the sector recovers some value; abandoning it stops the bleeding.

Mothballing beats idling on cost by design. If your selling share is very low and you are not willing to fight for share on price, mothball.

## Financing: bonds

Building plants takes cash, and bonds are how a corporation raises it. The essentials:

- **Caps.** A single issuance is limited to ${pct(MAX_BOND_ISSUANCE_REVENUE_FRACTION)} of your annual revenue. Total debt is limited to ${MAX_BOND_ISSUANCE_FRACTION}x your equity, and separately to ${MAX_BOND_ISSUANCE_EXIT_EQUITY_FRACTION}x what you could realize by selling up: your plants at book, your cash, and any bonds you hold. The second cap is usually the binding one for a built-out corporation, and it is deliberate. You are never lent more than your creditors could recover, which is also the test that decides whether you have defaulted. You cannot lever an empty shell into a war chest.
- **Cooldowns.** After an issuance, public corporations wait ${BOND_ISSUANCE_COOLDOWN_TURNS} turns before issuing again, private ones ${BOND_ISSUANCE_COOLDOWN_TURNS_PRIVATE}.
- **The coupon scales with your standing.** The rate you pay is your country's prime rate, plus a spread for your credit rating, plus a ${CORPORATE_BOND_SPREAD_PREMIUM} point corporate premium, plus a term premium on longer maturities. Coupons are paid every turn, and more debt means more coupons: your credit rating is scored on debt against equity, so borrowing heavily makes the next borrowing dearer.
- **Principal comes due.** At maturity the face value is debited from cash. Defaulting craters your credit rating and your bonds trade at pennies.

The sound pattern is to borrow against a build whose break even readout shows a clear payback, not to borrow because the cap allows it.

## Dominance: the cost of being big

Past ${DOMINANCE_MARKET_SHARE_THRESHOLD}% share of a sector's market in a state, or ${DOMINANCE_NATIONAL_SHARE_THRESHOLD}% of the national market for that industry, building further capacity gets progressively more expensive, ramping up to ${DOMINANCE_GROWTH_COST_MULT_AT_FULL}x the normal build price at a full monopoly. The game takes the harsher of the state and national figure, so spreading a national giant thinly across states does not dodge it.

Under the plants system dominance is a barrier to expansion, not a tax on operating: your existing plants run at an undistorted margin, but each additional unit of empire costs more than the last. Dominant sectors are also easier for rivals to attack. Being big is fine; buying the last quarter of a market is meant to be a luxury.

## Frequently asked questions

**Why is so much of my output unsold?**
The market for that product is oversupplied: everyone's plants together offer more than buyers want, and the market only clears what demand supports. Check the commodity page for your product. If the balance bar shows a big surplus, unsold output is the market working as intended. Lower your price to win share from rivals, or mothball, or point your capacity somewhere tighter.

**Why does one company show a huge market share?**
Share is measured per market, one industry in one place, and many markets are small or mostly unowned. A modest operation can be most of the player owned slice of a market that non player businesses otherwise serve. Check the market pie: the "Unowned" wedge is the part no corporation controls.

**Why did my margin number change when I did not change anything?**
Two reasons. First, the sector page now leads with the fill adjusted margin, which counts the cost of unsold units; the old number only looked at units that sold, which flattered any sector with a low selling share. Second, market prices for most commodities moved when demand was recently rebalanced, so what your inputs cost and what your output fetches both shifted. The "Per unit made" tile shows the current truth: what a unit earns against what it costs.

**Why do my builds arrive a bit at a time instead of all at once?**
Construction delivers capacity in equal per turn slices across the build window instead of one lump at the end. You earn from the delivered slices immediately, and the build queue shows exactly how much has landed and how much arrives per turn.

**My new sector shows almost no revenue. Is it broken?**
If it was just founded, its starter plant is still under construction and revenue grows as the build slices land. Check the build queue for the finish turn.

**A sector I can see shows $0 revenue for another player. Are they bankrupt?**
No. Live figures are owner only. Rivals see market share and the market pie; the money is hidden, not zero.

## Related

- [Market System: A Player's Guide](/wiki/market-system-guide): the tiers under the hood, clearing, price realization and valuation.
- [Corporations](/wiki/corporations): shares, CEOs, subsidiaries and corporate actions.
- [Commodities](/wiki/commodities): the commodity market and pricing mechanics.
- [Corporate Bonds](/wiki/corporate-bonds): issuance, ratings and default in depth.
- [Labour & Wages](/wiki/labour-and-wages): staffing the capacity you build.
`;

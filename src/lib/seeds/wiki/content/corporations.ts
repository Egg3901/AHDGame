export const corporationsContent = `# Corporations

Corporations are player-owned businesses that generate revenue, employ workers, and interact with state economies. Every character can found exactly one corporation. Corporations earn money each turn, respond to economic conditions, and can become a significant source of personal wealth and political leverage.

## Founding a corporation

To found a corporation, you need ₳1,000,000 in personal cash. That cost is deducted immediately, and your new corporation starts with ₳1,000,000 in liquid capital. You can optionally commit up to ₳50,000,000 in additional starting capital (deducted from your personal cash).

At founding you choose from **17 sector types**:

| Type | Label |
| --- | --- |
| technology | Technology |
| financial | Financial |
| energy | Energy |
| healthcare | Healthcare and Pharmaceuticals |
| media | Media |
| manufacturing | Manufacturing |
| retail | Retail |
| automobiles | Automobiles |
| agriculture | Agriculture |
| real_estate | Real Estate |
| defense | Defense |
| telecommunications | Telecommunications |
| entertainment | Entertainment |
| logistics | Logistics |
| extraction | Extraction & Mining |
| chemical_industries | Chemical Industries |
| construction | Construction |

Your chosen type is the corporation's **primary type**. Sectors matching your primary type receive a +5% profit margin bonus. You can later add a **secondary type** for a +2.5% bonus on sectors of that type.

The CEO receives 10,000,000 shares at ₳0.10 initial price. Your corporation's HQ is set to your current home state.

### Where you cannot found one

In a command economy the state owns production outright and **private corporations cannot be founded at all**. This covers the USSR, East Germany, Poland, Hungary, Czechoslovakia, Bulgaria, Romania and Yugoslavia. Their producing base is a stack of state-owned enterprises run through the national plan, with directors appointed by the state rather than founders. See [Planned / Command Economies](/wiki/planned-economies).

### Public vs private corporations

When you found a corporation, you choose between two structures:

- **Private**: you own 100% of shares. Other players see only your name, sector, headquarters, and credit rating. Your treasury, income, dividend rate, share price, and per-sector financials are **not** visible to non-CEO viewers.
- **Public IPO**: additional shares are issued to the public float at the same per-share price as your founding commitment. The cash raised flows into your corporation's treasury. You keep your founder shares (10,000,000) but your ownership share drops because total shares went up.

Float % is capped at 49% so a founder always emerges from an IPO with majority control. After founding, a private corporation can also IPO later via the **Go Public** action in the CEO admin panel (96-turn cooldown since founding or last privatization).

### Privatization buyouts

A CEO who controls more than 75% of a public corporation's **voting power** can call a privatization vote. Dual-class supershares count toward this, so a founder with voting control can privatize even if their economic stake is lower. The vote runs for 24 turns. Eligible voters are non-CEO character and corporation shareholders; the public float doesn't vote (no person owns it) but auto-tenders if the vote passes.

- Buyout price = current share price × 1.10 (10% premium), locked at vote-open time
- Vote passes on simple majority of voting power actually cast (abstentions don't count; supershares count for their extra votes)
- On pass: every non-CEO shareholder is bought out at the locked price; the public float is retired and the corp's treasury receives the equivalent payment; the CEO ends up with 100% of (now-reduced) total shares; the corporation becomes private
- On fail: the CEO's reserved cash is refunded and a 96-turn cooldown applies before another vote can be called
- While a vote is open, the CEO cannot issue new shares, run a stock split, or change the dividend rate
- Cross-currency privatization (CEO home currency ≠ corp currency) is currently blocked

### Shareholder governance votes

Public corporations use shareholder votes for governance changes, HQ relocation, dissolution authorization, and public share issuance. The CEO opens the vote from the corporation page, and each shareholder's ballot is weighted by the number of shares they control.

Votes run for 24 turns but can finish early once the result is mathematically certain:

- If yes shares reach the required threshold, the vote passes immediately.
- If the remaining unvoted shares can no longer make yes reach the threshold, the vote fails immediately.
- If neither side is certain, the vote resolves at the deadline.

The turn processor sweeps open corporation votes every turn, so passed or failed votes finalize even if nobody opens the vote page. Passed share-issuance votes add the approved shares to public float and credit the proceeds to corporate liquid capital.

## Expanding into markets

Corporations grow by acquiring **sectors** in state economies. A sector is not an abstract slice of a market: it **is the plants you own** in that state. The capacity is the real asset, and the revenue figure you see is derived from what that capacity actually produces and sells.

### Founding a sector

Entering a new state and industry is a **first build**, and it costs two things:

| Charge | What it is |
| --- | --- |
| Entry fee | Land, permits and licences. Scaled to your world's era money, so a 1953 permit is priced in 1953 money rather than modern money. Tech-tree expansion discounts reduce it. |
| Starter build | **One facility**, charged at a tenth of the normal build price. Getting your first plant into a market is deliberately cheap; everything you build after it is not. |

The capacity **arrives**; it does not appear. A new sector starts at zero capacity with the starter order sitting in its build queue, and it comes online in half the normal build time because a greenfield plant is scoped to its site from day one. Until the order lands, the sector produces nothing.

You can only build sectors in your **primary or secondary industry**.

### Market capture (splits)

Once you operate in a state you can "split" the unowned pool there to take capacity out of it:

| Parameter | Value |
| --- | --- |
| Cash cost | 5% of the unowned pool, floored at build price + 15% |
| MS cost | 2^escalation, so 1, 2, 4, 8, 16... |
| Capture | 5% of the pool × 1.25 unowned bonus × (1 + MS ÷ 100) |
| Escalation decay | Falls by 1 each turn, halving the cost back toward 1 MS |

Tariffs and your chosen split strength scale both the cost and the capture on top of that.

The floor is the part to internalise: a split hands you **real plant**, so it can never be cheaper than commissioning that capacity yourself. Splits buy you speed and position, not a discount.

Rapid splits get expensive fast, but waiting a few turns resets the cost.

### Attacking rivals

You can also take capacity directly off another corporation's sector. Unlike a split this is **contested**, and Marketing Strength decides the contest.

\`\`\`
contested = defender's capacity × 10% × dominanceEase × underdogBonus
capture   = contested × attackerMS / (attackerMS + defenderMS)
\`\`\`

Two multipliers exist specifically so entrenched monopolies stay breakable:

| Multiplier | Effect |
| --- | --- |
| **Dominance ease** | 1.0× at or below 50% market share, ramping to **3.5×** at 100%. The tighter a defender's grip on a state's sector, the softer it is to hit. |
| **Underdog bonus** | Up to **1.75×** for an attacker below 10% share striking a defender above 50%. It tapers away and is gone by 25% attacker share. |

**Attacks destroy plant.** The defender loses every unit taken, but the attacker receives only **60%** of them: the other 40% is wrecked in the taking. Raiding is value-destructive in aggregate, and the cash cost is floored at build price + 15%, so you can never raid your way to cheap capacity. What you are buying is a rival's position, not a bargain.

Non-player corporations raid too. An aggressive NPP-run corporation picks whichever target gives it the best expected capture, waits out a 24-turn cooldown between strikes, and holds a small MS reserve back. A corporation sitting on low Marketing Strength reads to that logic as a soft target.

When the matching feature flags are on, NPP CEOs also run the operator loop a player would: wages (quality hangs off that), same-country [supply agreements](/wiki/supply-agreements), extraction [prospecting](/wiki/resources-overview) against short deposits, and parking idle treasury in high-coupon [bonds](/wiki/corporate-bonds) instead of letting cash sit.

## Reading the numbers: time and money

Two different clocks run in this game. Mixing them up is the most common source of confusion about sector economics.

- **One turn is one hour.**
- **One financial day is 24 turns.** Every money figure is a daily rate: revenue, maintenance, wages, growth cost, profit.
- **One game year is 48 turns.** Growth rates are per game year. A game year is two financial days.

So an "annual" money figure is **2x** the daily figure, not 365x. That is correct, not a bug.

## Reading the numbers: nameplate to net profit

A sector shows more than one revenue figure. They mean different things, and only the last one drives your profit.

| Step | What it is |
| --- | --- |
| Nameplate revenue | What the plants you own could produce at list prices: capacity × price |
| Realization | Production policy, commodity prices, throughput and capacity applied to that nameplate |
| Realized revenue | What the sector actually earned. **Profit is computed from this** |
| Effective margin | Base margin plus every state, corporate and national modifier |
| Operating profit | Realized revenue x effective margin |
| Growth cost | Cost of the currently active growth rate |
| Net profit | Operating profit minus growth cost |

Nameplate revenue is **derived from the capacity you own**, so it does not compound on its own. Output grows when you build, and not otherwise. Revenue that moves without new plant is realization and clearing at work, not growth.

Realization can go **up** as well as down. If your output clears at a price premium, realized revenue is above nameplate and your profit is higher than nameplate x margin.

Commodity prices reach your bottom line by two separate routes. They move your **effective margin** through the commodity modifier, and they move your **realized revenue** through price realization. That is why changing a commodity price does not move your margin alone.

## Growth: what it costs

A growth rate is a percentage per game year. Its cost is charged every financial day.

Because a game year is two financial days, you pay the daily growth cost twice for each game year of growth. The total price of the revenue you add is the growth cost multiplier (currently 3x). Set growth to 0% to stop the charge entirely.

## Unowned sector growth

The unowned portion of every market sector grows automatically each turn at the **average growth rate of player-owned sectors** in that same state and sector type. If no player-owned sectors exist in that combination, it falls back to a 0.5% baseline growth rate.

This means unowned market share regenerates over time. A sector you partially captured will refill, so sustained expansion requires repeated splits or very high marketing strength to outpace regrowth.

## Per-turn processing

Every turn, the game processes each corporation through several phases:

1. **Production.** Inputs gate throughput and capacity gates output, so what you can physically make is settled first
2. **Clearing.** Your output is posted at your pricing posture and competes for real buyers, cheapest first. What doesn't sell doesn't earn
3. **Revenue and margin.** Realized revenue is set from what actually sold, then the effective margin applies every modifier below
4. **Capital.** Capacity depreciates, and any build orders that have come due are delivered
5. **Reputation.** Brand loyalty and output quality update from this turn's pricing and delivery
6. Corporate tax bases updated in federal and state budgets, then national budget revenue refreshed for state-owned corps
7. CEO salary paid from liquid capital, then dividends distributed to shareholders
8. Marketing, logistics and R&D strengths accrue from their budgets; split escalation decays by 1
9. Pending share orders filled, share prices recomputed, market cap and per-corp history snapshotted
10. Open shareholder votes auto-resolved and closing reminders sent

## Profit margin modifiers

Many factors adjust your sector profit margins. These are additive:

| Modifier | Max Effect | Notes |
| --- | --- | --- |
| Sector type match | +5% / -15% | Bonus if sector matches primary type; penalty if neither type matches |
| Secondary type match | +2.5% | If sector matches secondary type |
| Home state | +10% | Sectors in your HQ state |
| Same country | +5% | Sectors in your home country (not HQ state) |
| Unemployment | ±5% | Pivot at 3%; low unemployment hurts margins, high unemployment helps |
| Power grid | -4% | No penalty above 95% uptime; linear scale to -4% at 85% or below |
| Corruption | -3% | Linear scale to index 100 |
| Workforce skill | ±4% | Pivot at 50; applies to technology, chemical_industries, healthcare, manufacturing, defense |
| Crime rate | up to -5% | Applies to retail, real_estate, entertainment |
| Broadband access | up to -4% | Applies to technology, telecommunications, media, financial |
| Road condition | ±3% | Pivot at 60; applies to manufacturing, retail, agriculture, automobiles, construction, logistics, extraction |
| Carbon emissions | up to -3% | Applies to energy, chemical_industries, manufacturing, automobiles, extraction |
| Cost of living | ±3% | Higher cost of living raises labor costs; applies to manufacturing, retail, agriculture, construction, logistics, extraction, chemical_industries |
| Inflation | +2% to -8% | Bonus below 2%, penalty above |
| Debt-to-GDP | up to -5% | Penalty starts at 50% D/GDP |
| Deficit stimulus | up to +5% | +0.5% per 1% of GDP deficit |
| Subsidies | +7.5% per subsidy | Federal and state stack |
| Logistical sprawl | up to -0.5%/2 sectors | Penalty above 15 sectors; see Logistical Sprawl below |
| Type switch penalty | -10% | Active for 24 turns after switching primary or secondary type; 72-turn cooldown (24 penalty + 48 cooldown) before another switch |
| Strategy transition | -5% | Active during the 12-turn window when changing operating strategy |
| Tariff (foreign corp) | -(rate / 2)% | If your corp HQ is abroad and a tariff targets your origin country or sector |
| Tariff (domestic malus) | up to -10% | Economy-wide and sector tariffs create friction for all corps |
| Commodity input costs | ±50pp per commodity (soft cap) | Logarithmic; shortages in inputs you consume compress margins |
| Commodity output demand | ±50pp per commodity (soft cap) | Logarithmic; shortages in commodities you sell boost margins |
| Dominance margin penalty | up to -15% | Scales from 0 at ≤50% market share to -15pp at 100% share |
| Dominance regulatory burden | up to 5% of revenue | Compliance/antitrust cost; scales with market share above 50% |
|| Sustained negative production | up to -45% | Builds after 48 turns of negative production policy; full penalty at 144 turns |
| Sovereign default | up to -15% | Crisis-driven margin penalty from national or global default events |
| Nationalized | -15% | Government-owned corporations only |

Sectors that don't match your primary or secondary type receive a **-15% penalty**. Focused corporations outperform diversified ones unless you manage logistics carefully.

## CEO tools

### CEO salary

Set a daily salary (no minimum or maximum). It is deducted from liquid capital each turn. High salaries drain capital and reduce share price over time.

### Overhead cap

Combined daily spending on marketing, logistics, R&D, and CEO salary cannot exceed **150% of total daily sector revenue**. The game rejects budget updates that would push overhead past this limit.

### Marketing budget and Marketing Strength

Marketing Strength (MS) is your corporation's **economic-warfare currency**. It is not a sales stat: it does not raise demand, clear more of your output, improve your margin, or move your share price. What it decides is who takes market share from whom.

MS grows each turn from your daily marketing spend:

- Base: 1 MS per turn (any spend at all)
- Scaled: 0.65 × ln(1 + budget / 100,000)
- Diminishing returns on stored MS, doubling above MS 100

Starting MS is 10, and it has three uses:

| Use | How it works |
| --- | --- |
| **Offence** | Multiplies split capture by (1 + MS ÷ 100), and sets your share of a contested attack |
| **Defence** | Your MS is the denominator of every attacker's share. A defender holding 150 MS gives a 50 MS raider a quarter of the contested amount instead of all of it |
| **Ammunition** | Every split and attack spends MS. Run out and you cannot act at all |

**MS does not decay.** Logistics strength bleeds 5% a turn and R&D score 3%, but marketing strength only falls when you spend it, or when you rename the corporation (-25%). That makes it a stockpile rather than a maintained level, so funding it hard early and then cutting back banks a permanent reserve.

If nobody is attacking you and you have no intention of splitting or attacking, marketing spend buys you nothing, and it still counts against the 150% overhead cap.

**Marketing Strength is not brand loyalty.** Loyalty is a separate reputation earned through consistent pricing and delivery, and no amount of marketing spend contributes to it. See [Brand Loyalty](/wiki/brand-loyalty).

### Logistical sprawl

Corporations with more than **15 sectors** incur a -0.5% margin penalty per 2 sectors over the threshold. With a secondary type set, that doubles to -1.0% per 2 sectors. Logistics & Operations (your distribution reach and operational process quality) spending raises the threshold (up to 30 sectors at max Logistics & Operations Strength of 200) and halves the penalty slope.

### Research, tech trees & wages

**Tech tab:** Every corporation has a **Tech** tab with decade-tiered research nodes. Each decade offers a **Corporate** lane (shared business upgrades) and a **Sector** lane (specialist unlocks for your primary type). Nodes cost **R&D Score + cash** and can gate advanced operating strategies. See [Corporate R&D & Tech Trees](/wiki/corporate-r-and-d) for lane commitment, prerequisites, and effects.

**R&D budget:** Daily R&D spend builds an **R&D Score** (log-scaled, 3% decay) used for tech unlocks and periodic innovation breakthroughs every 6 turns. R&D counts against the 150% overhead cap.

**Wage level:** When the labour system is enabled, each sector exposes a **wage slider** (default 1.0) that moves explicit labour cost without changing baseline outcomes at default. Minimum-wage legislation can floor low-pay sectors. See [Labour & Wages](/wiki/labour-and-wages).

### Production policy

Each sector has a production policy on a **-25 to +25 scale**. The active level trends toward your target at 1 unit per turn. It multiplies revenue, commodity output (supply), and commodity input consumption (demand) asymmetrically:

| Level | Revenue | Commodity output | Commodity input consumption |
| --- | --- | --- | --- |
| **+25** (Aggressive) | +10% | +15% | +10% |
| **+10** | +4% | +6% | +4% |
| **0** (Neutral) | baseline | baseline | baseline |
| **-10** | -2% | -4% | -6% |
| **-25** (Conservative) | -5% | -10% | -15% |

Aggressive policy maximizes revenue and commodity throughput but also raises input costs. Conservative policy protects margins by sharply cutting input consumption while accepting reduced output. The asymmetry is intentional: at maximum conservation, input reduction (-15%) outpaces output reduction (-10%) because lean operations waste less.

## Operating strategies

Each sector type has **2 to 8 operating strategies** that change which commodities it supplies and demands. Strategies are how you specialize: an energy sector can run Conventional (fossil fuels), Renewables Focus (solar/wind using electronics and rare earth), Nuclear Expansion (high output, heavy steel and chemicals), and several more besides. A chemical industries sector can pivot between industrial chemicals, fertilizer production, pharmaceuticals, or plastics.

**Strategies have no direct margin bonus**: their value comes entirely from commodity market dynamics. Switching to a strategy that supplies a scarce commodity or avoids expensive inputs can dramatically improve margins; switching into an oversupplied market does the opposite.

### Switching strategies

| Parameter | Value |
| --- | --- |
| Initiation cost | 25% of sector daily revenue |
| Transition duration | 12 turns (rates interpolate linearly) |
| Transition margin penalty | Progressive −5% over 12 turns (starts at 0%, reaches full −5% at completion) |
| Cooldown | 24 turns from initiation before another switch |

During the transition, commodity flows blend from the old strategy toward the new one. The penalty represents retooling disruption. You can see a before/after comparison of estimated margin impact in the sector detail panel before confirming a switch.

Computer-run corporations may automatically retool a sector onto a better strategy when prices squeeze the current recipe. A strategy you set yourself is never changed by that pass.

### Strategy overview by sector type

| Sector | Strategies |
| --- | --- |
| Sector | Strategies | Count |
| --- | --- | --- |
| Energy | Hydraulic Fracturing, Conventional, Renewables Focus, Nuclear Expansion, Smart Grid, Fusion Generation | 6 |
| Manufacturing | Standard, Heavy Metals, Electronics Manufacturing, and more | varies |
| Technology | Standard, Hardware Focus, Software Focus, and more | varies |
| Agriculture | Traditional, Industrial, Sustainable | 3 |
| Chemical Industries | Industrial Chemicals, Fertilizer Production, Pharmaceuticals, Plastics & Polymers | 4 |
| Healthcare | Standard, Hospital Networks, Outpatient & Preventive | 3 |
| Automobiles | Standard, EV Focus, Heavy Machinery | 3 |
| Financial | Standard, Fintech, Traditional Banking | 3 |
| Media | Standard, Digital-First, Legacy Broadcast | 3 |
| Defense | Directed-Energy Systems, Standard, Cyber Warfare, Heavy Armor, Munitions & Arms Export, Naval Systems, Missile & Rocket Systems, Aerospace Systems | 8 |
| Real Estate | Standard, Commercial Development, Green Building | 3 |
| Construction | General Contracting, Infrastructure Buildout, Modular Construction | 3 |
| Telecommunications | Standard, 5G/Infrastructure, Cloud Services | 3 |
| Entertainment | Standard, Streaming/Digital, Live/Venue | 3 |
| Retail | Standard, E-Commerce, Brick & Mortar | 3 |
| Logistics | Standard, Automated Logistics, Full-Service | 3 |
| Extraction & Mining | Diversified, Iron & Metals Mining, Oil & Gas, Rare Earth Minerals Mining, Coal Mining, Timber & Forestry | 6 |

There is no separate Copper Mining strategy: copper was merged into the Rare Earth Minerals commodity, and Rare Earth Minerals Mining covers both markets.

For extraction sectors specifically, the **Diversified** strategy spreads output across all six resource types (copper is merged into the Rare Earth Minerals market) at lower per-commodity rates. The focused strategies (Iron & Metals Mining, Oil & Gas, etc.) produce roughly **3 to 5×** more of their target commodity, so switching to the focused strategy that matches the scarcest resource is almost always the higher-margin play when a clear shortage exists. See [Commodities](/wiki/commodities#extraction-strategies) for a full breakdown.

**Telecommunications** sectors produce **Network Services** (subscription-equivalent broadband/connectivity capacity) as their primary unique output alongside software. The three strategies (Standard, 5G/Infrastructure, Cloud Services) differ in how much network_services vs software they supply and in their hardware/energy input mix. Network services have background macro demand from GDP, so there is always a market even before player-built Telecom sectors are common.

**Entertainment** sectors produce **Entertainment Services** (event-equivalent entertainment capacity) as their primary unique output alongside advertising. The three strategies (Standard, Streaming/Digital, Live/Venue) differ in output split and input profile. Live/Venue supplies the most entertainment_services but demands construction and real estate inputs for physical venue infrastructure.

## Corporate taxes

Two tax rates apply to each sector: a **domestic rate** and a **foreign rate**. A corporation headquartered in the US pays the US domestic rate on US sectors and the foreign rate of any other country where it operates. Both rates are set by legislation in each country. State-level corporate taxes also stack on top.

## Economic effects on corporations

Your corporation's sectors respond to state and national conditions:

- **State GDP growth** is driven by the revenue-weighted average of all corporate sector growth rates in that state.
- **Commodity markets** affect margins: steel shortages hurt manufacturing, oversupply in energy compresses energy sector margins.
- **Bills and policies** can create subsidies (+7.5% margin) or trigger tariffs (foreign corps pay margin penalties in target countries).

## Shares and dividends

The CEO sets a **dividend rate** (0 to 25% of after-tax income). Dividends are paid each turn to all shareholders proportional to their share count. Players buy and sell shares on country stock exchanges.

**Share price formula:**
The share price is computed from three fundamental components:

- **Tangible book per share** (weight 1.0): \`(liquidCapital + sectorNPV + bondHoldings - issuedBondDebt) / totalShares\`
- **Earnings power per share** (weight 0.4): \`normalizedAnnualEarnings / costOfCapital / totalShares\`
- **Growth premium per share** (weight 0.1): Gordon Growth Model (a formula for valuing a company based on how fast its dividends grow) terminal value using the revenue-weighted sector growth rate, capped just below the cost of capital

The three components sum to a fundamental value, which becomes the share price except during a post-split smoothing window (2 turns after a stock split or reverse split, where the formula biases 70% toward the previous price to avoid instant reversion).

An IMF bailout active on the corporation applies a price multiplier.

## National corporations

Some corporations are government-owned (e.g., the UK NHS). These cannot be purchased or attacked. Their revenue flows through the national budget rather than to a CEO.

## Merger review

When two corporations become one, the state may have a say. This applies to an agreed acquisition and to the squeeze-out that ends a hostile takeover, at the moment the two firms actually combine.

**When it applies.** Both sides must be privately owned, and the market being consolidated must be a market. A state-owned corporation on either side is out of scope: consolidating firms the state already owns is an administrative matter, not a transaction anyone approves. In a command economy the whole system is dormant for the same reason.

**What trips it.** The combined firm's share of a national industry, measured on the same basis the Market Share chart shows. The threshold comes from the country's competition law:

| Enforcement level | Referred at a combined share of |
| --- | --- |
| No enforcement | Never |
| Case-by-case review | 75% |
| Active enforcement | 60% |
| Structural enforcement | 50% |
| Open markets charter | 40% |

**Who decides.** The cabinet seat that country gives the job: the Attorney General in the United States, the Board of Trade in Britain (later Trade and Industry, later Business), the trade ministry elsewhere. The seat has six turns.

**What they can decide.** Clear it, block it, or clear it on condition that the combined firm divests the industry that tripped the threshold. If the seat says nothing for six turns, the decision falls out of published bands: within 5 points of the threshold it clears, within 15 it clears with conditions, beyond that it is blocked. No hidden roll.

**Conditions have teeth.** A divestiture order is discharged by measurement, not by paperwork. Spinning the business into a wholly-owned subsidiary changes nothing: the same group still holds the same share of the same market. You have to sell it down until the group no longer controls it. Miss the deadline and the corporation is fined 5% of its group revenue in that industry every turn, paid to the treasury, and cannot open new acquisitions until the order is met.

**Blocked is blocked.** A blocked pairing cannot be retried. A cleared one does not need a second referral, so a hostile takeover that was referred can simply be run again once it clears.

## Interaction with politics

Corporations connect to politics in several ways:

- Legislation creates subsidies, tariffs, and tax rate changes that directly affect margins
- Senators and Representatives can advance bills that benefit their sector
- The national budget receives corporate tax revenue: profitable corps help state finances
- The IMF facility and crisis systems can affect corporate borrowing costs and credit ratings

See also: [Running a Corporation under the Plants System](/wiki/plants-corp-guide), [Market System: A Player's Guide](/wiki/market-system-guide), [Private Banking](/wiki/private-banking), [Logistics: Freight, Sourcing, and Supply Chains](/wiki/logistics-guide), [Brand Loyalty](/wiki/brand-loyalty), [Output Quality](/wiki/output-quality), [Corporate Bonds](/wiki/corporate-bonds), [Corporate R&D & Tech Trees](/wiki/corporate-r-and-d), [Labour & Wages](/wiki/labour-and-wages), [Unions](/wiki/unions), [Stock Market](/wiki/stock-market), [Commodities](/wiki/commodities), [National Budget](/wiki/national-budget)
`;

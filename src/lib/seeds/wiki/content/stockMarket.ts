export const stockMarketContent = `# Stock Market

Corporations are listed on country-specific stock exchanges. Players can buy and sell shares, receive dividend income, and speculate on corporate performance. Each country has its own exchange showing corporations headquartered there.

## Exchanges

| Country | Exchange | URL |
| --- | --- | --- |
| United States | NYSE | /stockmarket/us |
| United Kingdom | FTSE | /stockmarket/uk |
| Germany | DAX | /stockmarket/de |
| Japan | Nikkei | /stockmarket/jp |
| Ireland | ISEQ | /stockmarket/ie |
| Brazil | B3 | /stockmarket/br |
| China | SSE | /stockmarket/cn |
| Nigeria | NGX | /stockmarket/ng |

Exchange pages display: market cap, share price, total revenue, net income, CEO, sector type, and headquarters location. Price history is shown as **OHLC candlestick charts** (open, high, low, close per period).

## Share price formula

Share prices are computed each turn from three fundamental components:

**Tangible Book Per Share** (weight 1.0):
\`\`\`
tangibleBook = liquidCapital + sectorNPV + bondHoldings - issuedBondDebt
tangibleBookPerShare = tangibleBook / totalShares
\`\`\`

Where sectorNPV is each sector's future profit converted to today's value (its annual profit divided by the cost of capital, the return investors expect), and bondHoldings counts bonds at their current market price plus IMF receivables held by the corporation.

**Earnings Power Per Share** (weight 0.4):
\`\`\`
earningsPowerPerShare = normalizedAnnualEarnings / costOfCapital / totalShares
\`\`\`

\`normalizedAnnualEarnings\` is a 3-turn rolling average of annualised after-tax income, with equity-method additions from any cross-corporation stock holdings already applied.

**Growth Premium Per Share** (weight 0.1):
\`\`\`
gCapped = min(sectorGrowthRate, costOfCapital - buffer)
growthPremiumPerShare = (normalizedAnnualEarnings * gCapped) / (costOfCapital - gCapped) / totalShares
\`\`\`

This is a standard formula for valuing future growth (the Gordon Growth Model). The growth rate is capped just below the cost of capital so the denominator stays positive.

**Final price:**
\`\`\`
sharePrice = 1.0 * tangibleBookPerShare
           + 0.4 * earningsPowerPerShare
           + 0.1 * growthPremiumPerShare
\`\`\`

The formula produces a **fundamental value** each turn. During normal operation the market price equals this fundamental value. Additional multipliers (sentiment, order flow, IMF bailout) can adjust the displayed market price in real time.

**Constants:**
| Constant | Value |
| --- | --- |
| Minimum share price | 0.01 |
| Tangible book weight | 1.0 |
| Earnings power weight | 0.4 |
| Growth premium weight | 0.1 |
| IMF bailout multiplier | 0.8 (applies when active) |

## Buying and selling shares

From any corporation page, navigate to the Shares tab.

### Market orders

Buy or sell immediately at the current market price through the system's market maker. Fills instantly with infinite liquidity.

### Limit orders

Place a buy or sell order at a target price. The order sits on the book and fills automatically when the market price crosses your limit. You can set an optional expiry (cancel after N turns if unfilled).

- **Buy limit orders:** Funds are held in escrow until filled or cancelled
- **Sell limit orders:** Shares are reserved until filled or cancelled

### Partial fills

If insufficient liquidity exists at your limit price, the order fills partially: the matched portion executes, the remainder stays open.

### Order-flow price eligibility

Corporations with a **public float below 5%** of total shares do not use the live market price for order execution. Instead, trades fall back to the **fundamental share price** computed by the turn formula. This prevents a single concentrated holder from manipulating the order-flow clamp and round-tripping against their own quote.

## Dividends

The CEO sets a **dividend rate** (0 to 25% of after-tax income). Dividends are paid to all shareholders each turn in proportion to their share count. Higher dividend rates attract income-focused investors but reduce the corporation's reinvestment capacity.

Dividend rate changes have a **24-hour cooldown** before another change can be made.

## CEO share management

### Share issuance

- **Public issuance:** Issue up to 50% of outstanding shares to the public float (dilutes existing shareholders). Proceeds go to corporate liquid capital at the current execution price. Limited to once per 24 hours.
- **Self-issuance:** Issue up to 20% of outstanding shares to yourself as CEO at a 15% premium; proceeds go to corporate liquid capital. Also limited to once per 24 hours and shares the same issuance cooldown with public issuance.

### Stock splits and reverse splits

The CEO can change the total share count via a split or reverse split. All shareholders and the public float are scaled proportionally: ownership percentages stay the same, market cap is unchanged. Share price scales inversely to keep total value constant.

- **Forward split:** Up to 100x current total shares
- **Reverse split:** Down to a minimum of 1,000,000 total shares
- **Cooldown:** 48 turns between changes
- **Open orders:** Any open share orders on the corporation are auto-cancelled and refunded when a split occurs

### Post-split price smoothing

For **3 turns total** (the turn the split happens plus the next 2 turns), the share-price formula uses **biased smoothing weights** to prevent the price from snapping back to the pre-split equilibrium immediately:

| Phase | Previous price weight | Fundamental weight |
| --- | --- | --- |
| Normal | 0% | 100% |
| Post-split cooldown | **70%** | **30%** |

The higher previous-price weight means the scaled price set by the consolidate route drifts gradually toward its natural equilibrium across multiple turns, rather than being overwritten by fundamental value on the very next turn. This cooldown applies to both forward splits and reverse splits.

## Share history

The **Shares tab** on every corporation page includes a full audit trail of every share movement:

| Event type | What it records |
| --- | --- |
| Issuance | CEO issued shares (public or self-issuance) |
| Market buy / sell | Trades against the public float |
| Limit fill | A limit order auto-filled or was manually filled |
| Peer fill | Another player filled your open order |
| Listing fill | A private listing offer was accepted |
| Takeover buyout | Hostile takeover forced a minority sale |
| Stock split | Forward split with before/after shareholder register |
| Reverse split | Reverse split with before/after shareholder register |

### Split audit rows

When a CEO drives a stock split or reverse split, the history records an expandable row showing:
- **Old total shares → new total shares**
- **Old share price → new share price**
- **Old public float → new public float**
- **Full shareholder register before and after**, including each holder's name, share count, and percentage

This lets any player audit structural changes and verify that ownership percentages were preserved and that no holder was accidentally dropped during the restructure.

## CEO elections (shareholder vote)

When the CEO office is vacant, shareholders can vote for candidates. The vote is **weighted by shares**: 500 shares = 500 votes, not one vote per holder.

**Candidate eligibility:**
- Must be located in the corporation's **HQ state**
- Must be in the corporation's **home country**
- Self-voting is allowed

The leading candidate (highest share-weighted vote total) receives a pending CEO offer notification. They must accept the position before taking office.

## Corporate ownership and subsidiaries

Corporations can hold shares in other corporations. When one corporation holds **more than 50% of another corporation's voting power**, it becomes that corporation's controlling parent. Voting power is not the same as share count where a corporation has issued supershares. The largest corporate stake above 50% wins ties.

Control on its own makes the target a **de facto subsidiary**: the relationship shows on the corporation page and on the exchange, and it feeds cross-holding calculations in the share-price formula.

**Managing** a subsidiary is a separate, deliberate step. The parent's CEO must **formalize** the relationship, and only then can the parent:

- inject capital into the subsidiary (capped per injection, with a cooldown)
- set a dividend floor the subsidiary must pay out
- appoint the subsidiary's CEO

A formalized subsidiary cannot issue new equity, cannot itself act as a parent to another corporation, and cannot be released again until it has been held for a minimum period. A corporation can never buy into a corporation that already controls it, directly or through a chain: circular ownership is refused at the point of purchase.

Profits do **not** consolidate. Each corporation is taxed on its own sectors, and a parent sees its subsidiary's earnings through dividends and through the share price, not as its own operating income.

## Corporate groups

A parent and its **formalized** subsidiaries form a **group**. De facto control is not enough: the group is the set of relationships the parent has actually declared.

**Group balance sheet.** The corporation page shows the consolidated position of the whole group — combined cash, combined revenue, every member, every industry and country it operates in. It is a view, not a merger: members keep their own balance sheets, share prices and shareholders. Group size is visible to everyone, not just the parent's CEO. A structure should be a way to organise a business, not a way to disappear.

**Group loss relief.** Within a single country, a group's losses are surrendered against its profits, and the group is taxed on the net. A parent earning ₳1,000,000 alongside a subsidiary losing ₳250,000 is taxed as though it earned ₳750,000; the tax on the sheltered ₳250,000 is refunded from the treasury that collected it, split across the members that actually paid.

Four limits, all of them deliberate:

- **Same country only.** A loss in one country cannot shelter a profit in another.
- **Losses cannot exceed profits.** A ₳5,000,000 loss against a ₳1,000,000 profit relieves ₳1,000,000. There is no carry-forward.
- **Relief never exceeds the tax the group actually paid.** The state refunds; it does not pay out.
- **Formalized subsidiaries only.** Relief is bought with a declaration.

That last point is the trade. Formalizing a subsidiary is what unlocks relief, and it is also what makes the group legible — to everyone reading the corporation page, and to the competition authority reviewing your next merger.

## Group synergies

A group is not only a tax structure. Each turn, its members converge toward the group's **best** marketing and logistics capability, closing 5% of the gap per turn, up to 60% of the leader's level.

**Synergy only ever lifts.** No member is reduced to bring the group toward an average. Averaging would mean acquiring a weak subsidiary drags your strong parent down, and the optimal move would be to never group anything — which is not what a group is for. The strong member's distribution network and brand are what the weak one gets access to, not the other way round.

A member already above the capped share gains nothing. There is no reason to hold a flagship back.

**A spin-off carries the brand out with it.** A corporation spun off from a group member keeps a higher ceiling — 85% instead of 60% — for two game years, because last turn it was literally part of that business. The advantage decays as the spin-off becomes its own company, and it disappears immediately if the corporation it came from leaves the group.

## Transfer pricing

Supply agreements carry an agreed price offset from market. Between two unrelated corporations that is a negotiation. Between two members of the same group it is a dial: both sides have the same owner, so the price decides which member books the profit — and when those members sit in **different countries**, it decides which treasury collects the tax.

Price an intra-group cross-border contract away from market and the shifted profit accumulates as **exposure** on that contract. Cross ₳5,000,000 of accumulated exposure and the treasury that lost the base reassesses: it charges the tax that was avoided, plus a **40% surcharge**, and the exposure resets to zero.

The surcharge is the point. Without it an assessment is a free option — worst case, you pay exactly the tax you owed anyway, later.

Three things worth knowing:

- **It is deterministic.** No dice. You can work out precisely how many turns a given position survives, which makes aggressive pricing a calculated risk rather than a gamble.
- **A position you unwind stops accruing.** Price aggressively for a while and return to market before the threshold, and you have taken a real risk and got away with it.
- **Small offsets are ignored.** Anything within 5% of market is ordinary commercial pricing, not a tax position.

Same-country intra-group pricing is not audited at all: both sides pay the same treasury, so no base moves, and group loss relief already nets the two positions against each other.

An assessment you cannot afford is not waived. It is collected as far as your balance goes, and the exposure resets either way.

## Hostile takeovers

When a corporation (the acquirer) holds **at least 75%** of a target corporation's shares, the acquirer's CEO can initiate a **hostile takeover**:

- **Minority buyout:** All remaining minority shareholders are paid **125% of the current market price** per share (forex-aware)
- **Sector merge:** Overlapping sectors (same state and sector type) are combined, summing revenue, workers, and margins
- **Unique sectors:** Sectors that don't overlap are reassigned to the parent
- **Cash transfer:** The target's liquid capital is transferred to the parent
- **Orders cancelled:** All open share orders and listings on the target are cancelled
- **Restrictions:** Cannot target insolvent corporations or corporations with outstanding bonds

## Stock exchange index

The exchange page shows aggregate stats for all listed corporations:
- Total market capitalization
- Average share price movement
- Top movers (largest price % change)

National GDP growth is influenced by corporate sector growth rates, so a healthy stock market generally reflects a growing economy, and vice versa.

## Currency

Each exchange displays values in that country's currency. If you hold shares in a UK corporation, dividends are paid in GBP. When the forex system is enabled, dividends are automatically converted to your home currency at the market-maker rate (0.275% spread). There is no per-holding preference: this conversion is automatic for all dividend income.

## Strategic considerations

**Income investors:** High-dividend corporations pay consistent per-turn income. Look for profitable, stable sectors with CEOs who maintain high dividend rates.

**Growth investors:** Low or zero dividend corporations reinvest profits into expansion. Share price appreciation comes from rising tangible book value and earnings power.

**Speculation:** Share prices react to economic events each turn via the fundamental formula. If you anticipate a subsidy bill passing or a major sector entering a state, position before the turn processes.

**Influence:** Owning enough shares gives you a voice in CEO elections. A significant stake can swing a contested vote.

**Concentration risk:** Corporations with very low public floats (below 5%) fall back to fundamental pricing for trades, which can create a liquidity gap between the market quote and execution price.

See also: [Corporations](/wiki/corporations), [Corporate Bonds](/wiki/corporate-bonds), [Currency Exchange](/wiki/currency-exchange), [National Metrics](/wiki/national-metrics)
`;

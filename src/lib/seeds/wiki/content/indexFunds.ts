export const indexFundsContent = `# Index Funds

Index funds are investment vehicles that passively track a market segment. Rather than picking individual stocks, a player subscribes to a fund that holds a basket of underlying assets, and the fund's net asset value (NAV) moves with that basket. Income from the underlying holdings is distributed to subscribers through a dividend pass-through.

## Feature flag

Index funds are gated behind a three-state feature flag:

\`\`\`
getIndexFundsMode() → "off" | "partial" | "full"
\`\`

| Mode | Behaviour |
| --- | --- |
| \`off\` | No index funds exist in the game |
| \`partial\` | Funds are visible but players cannot transact (view-only) |
| \`full\` | Full subscribe / redeem functionality is enabled |

Check the mode before building any UI that assumes the player can trade funds: in \`partial\` mode the data is read-only.

## How a fund works

Each fund holds a fixed basket of underlying holdings (corporate shares, sovereign instruments, or other market positions). The fund computes a **net asset value (NAV)** from the current market value of those holdings:

\`\`\`
NAV = sum(holding.quantity × holding.marketPrice)
\`\`\`

When a player **subscribes** (buys in), cash is converted into fund units at the current NAV. When a player **redeems** (withdraws), units are converted back to cash at NAV. There is no active management: the fund simply tracks its basket.

## Dividend pass-through

When underlying holdings pay dividends, the income is split between the fund and its subscribers:

\`\`\`
dividendIncome = sum(holding.dividendPerUnit × holding.quantity)

reinvested   = dividendIncome × 0.75   // → fund cash, grows NAV
passThrough  = dividendIncome × 0.25   // → paid to current unit holders
\`\`

| Portion | Destination | Effect |
| --- | --- | --- |
| 75% | Fund cash (reinvested) | Increases underlying positions / NAV over time |
| 25% | Unit holders (pass-through) | Direct income to subscribers each turn |

This means a fund compounds 75% of its income internally while still giving holders a steady 25% cash yield: a hybrid between a growth ETF and an income fund.

## Subscribing and redeeming

| Action | Requirement | Result |
| --- | --- | --- |
| Subscribe | Cash ≥ subscription amount | New units credited at current NAV |
| Redeem | Fund units ≥ redeem amount | Units destroyed, cash credited at NAV |

Transactions settle at the NAV computed on the turn the order is processed. There is no intraday pricing: NAV updates once per turn with the market cycle.

## NAV example

Suppose a fund holds 1,000 units of Stock A at ¥120 and 500 units of Stock B at ¥80:

\`\`\`
NAV = (1,000 × 120) + (500 × 80) = 120,000 + 40,000 = ¥160,000
\`\`\`

If the fund has 2,000 outstanding subscriber units, each unit is worth ¥80. A player subscribing ¥4,000 receives 50 units; the fund's cash grows and NAV is recomputed next turn.

## Strategic notes

- **Passive exposure:** Index funds are the cheapest way to gain broad exposure to a market segment without managing individual positions.
- **Compounding:** Because 75% of dividends reinvest, funds with strong underlying holdings grow NAV over time, ideal for long-term holds.
- **Liquidity:** Redeem at any time at NAV. Unlike individual bonds, there is no maturity lock-up.
- **Management fee:** System funds charge nothing beyond the pass-through split (75/25). A **sponsored** fund charges an annual expense ratio, shown on its card. Check it before you subscribe.
- **Visibility:** A fund is not a black hole on your net worth. Fund cash counts in the national money supply, and your fund units are valued at the quoted NAV in your portfolio snapshot alongside shares and bonds. Moving cash into a fund changes what you hold, not what you are worth.
- **Tax:** Fund dividends and redemption proceeds are not taxed at the individual level, exactly as direct share dividends and share sales are not. Capital-gains tax is levied on the economy as a whole through the national budget, not on your trades. Holding an index fund is therefore never worse for tax than holding the same shares directly.

## How a fund votes its shares

A fund that holds a large slice of a corporation holds real votes. It is not a
person and has no opinion of its own, so where those votes go is decided by a
rule rather than by the fund:

- **Directed.** A unit holder who owns at least half the fund's units controls
  it, and the fund votes the way that holder instructs on each shareholder
  vote. This is what makes buying units a route to corporate influence rather
  than just exposure. You give the instruction on the vote itself, and you can
  change it or withdraw it while the vote is open.
- **Undirected.** With nobody in control, the fund votes with the majority
  actually cast by everyone else. A passive vehicle follows the owners of the
  company rather than overruling them.
- **Abstaining.** With no controller and no majority to follow, including a
  tie, the fund sits the vote out and its shares come out of the count
  entirely. A threshold measured against shares nobody can cast is how a
  fund-heavy corporation used to end up unable to decide anything.

Control is checked when the vote resolves, not when the instruction is given.
Sell below half the units before the vote closes and your instruction lapses;
it does not pass to whoever bought them.

## Listing standards

Not every listed corporation belongs in an index. Being in one means a large, automatic, price-insensitive buyer starts absorbing your float, and that should be earned.

A corporation qualifies for an index when it clears three bars:

| Standard | Requirement |
| --- | --- |
| Free float | At least 15% of shares in public hands |
| Size | At least 5% of the median market cap of the index's other candidates |
| Solvency | Not balance-sheet insolvent |

**The size bar is relative, not a fixed amount.** An absolute floor would be meaningless in a modern world and impossible in a 1953 one where the whole economy is smaller. Measuring against the median candidate means the bar says the same thing in every era: not a rounding error next to your peers.

It is measured against the corporations competing for *that* index, so a small-country fund judges you against that country's market rather than against the world.

**Falling below the bar does not drop you immediately.** An existing constituent must fail for three consecutive observations first. Without that, ordinary price noise around the threshold would churn the same position in and out every turn, and the fund's holders would pay the spread both ways for the volatility of the bar rather than of the business.

The grace period protects incumbents against noise, not applicants against the standard. A corporation that has never qualified is held to the bar on the spot, and one that recovers for a single observation has its count reset. When the grace runs out the fund sells the position and says which standard was missed.

**Missing data never excludes anyone.** A corporation with no recorded public float is treated as unknown, not as zero. The screen is there to remove corporations that demonstrably fail a standard, not ones nobody has measured.

## The index committee

Listing standards are a rule, and a rule needs somebody who can be argued with. A corporation that misses a standard can petition its country's index committee to be admitted anyway.

The committee is not a new institution: it is the same cabinet seat that rules on merger review, so the officeholder who decides whether two firms may merge also decides who belongs in the national index. A country whose era has no such seat has no committee, and no waivers.

**What a waiver can buy.** Free float and size are qualification bars and can be argued about. Solvency is not. No committee, and no rule, can wave an insolvent corporation into an index, because that would make fund holders pay for a political favour.

**What it costs.** Petitioning is lobbying, and lobbying costs corporate cash. The contribution is paid on filing and is never returned, whatever the answer. If a player holds the seat, the money reaches them personally, and the record of who paid what to whom is public. If the seat is vacant or held by an NPP, the money goes to the treasury instead: the spend still happens, but nobody pockets it.

**Who decides.** A seated player rules directly. Otherwise the deadline rules, by a fixed rule rather than a roll of the dice: a large enough contribution, against a shortfall close enough to the bar to be defensible. Money alone will not carry a shell into an index, and being nearly qualified will not get you in for free.

**A waiver is a licence, not an exemption.** It runs for a fixed term. A corporation that never fixes the underlying problem has to go back and ask again, in front of whoever holds the seat by then.

## Sponsored funds

Most funds in the game are run by the system: one broad fund per country, one per industry, one global. A **sponsored fund** is one a player's corporation charters and runs as a business.

**Who can sponsor.** A corporation with a financial sector. Running other people's money is what the sector is for.

**What it costs to start.** A non-refundable charter fee of ₳2,500,000 to the sponsor's national treasury, plus at least ₳10,000,000 of seed capital paid into the fund itself.

**What the sponsor chooses.** A name and ticker, a mandate, and a fee.

The mandate is the same two choices that define every system fund: a scope (one country, or global) and a kind (broad, or a single industry). A sponsor does not hand-pick which corporations the fund holds. An index fund that lets its sponsor choose the basket is not an index fund.

**How the sponsor earns.** An annual expense ratio between 0.10% and 2.00% of assets under management, taken from fund cash a slice at a time each turn and paid to the sponsoring corporation as revenue. That is the whole business model: the sponsor does **not** hold an investor's stake in the fund, so the way to make money is to attract unit holders and keep them, not to trade against them.

The fee is a real drag on your return as a holder. It is on the card. Compare it.

**When the sponsor stops earning.** Two cases, both automatic:

- The fund's backing ratio falls below 90%. The sponsor is paid nothing while holders are impaired.
- The fund is winding up. Deciding to close it ends the income immediately, so there is no reward for dragging it out.

The fee is also never taken by forcing a sale. If the fund has no spare cash, the sponsor is simply not paid that turn.

**Winding up.** A sponsor can close a fund they charter, but not instantly. The fund enters wind-up, stops buying and stops charging its fee, and sells its holdings back into the market over the following turns. Once the portfolio is cash, every unit holder is paid out at the final value, which is what the portfolio actually sold for rather than the last quoted NAV, and only then does the sponsor get back whatever remains of their seed capital.

Seed capital is last in line. A fund that lost money costs its sponsor before it costs anyone else.

See also: [Stock Market](/wiki/stock-market), [Corporate Bonds](/wiki/corporate-bonds), [Central Banks](/wiki/central-banks)
`;

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
- **No active management fee:** The pass-through split (75/25) is the only cost; there is no separate management fee deducted.

See also: [Stock Market](/wiki/stock-market), [Corporate Bonds](/wiki/corporate-bonds), [Central Banks](/wiki/central-banks)
`;

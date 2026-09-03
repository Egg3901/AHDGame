# Issue 990 index-fund liquidity balance report

Date: 2026-09-03

## Question

Can index funds quote the whole eligible equity market with useful depth while
keeping every bid cash-backed, every ask inventory-backed, and aggregate risk
inside the existing fund limits?

## Method

`scripts/sim/indexFundLiquidity2026-09-03.ts` runs a deterministic synthetic
market through the portable quote rules. The market has 368 eligible listings,
18 global broad funds, 143,333 issued shares per corporation, varied share
prices, and 100 million anchor of assets per fund, including 10 million cash.
Each listing starts in one fund's inventory so the old holding-only planner gets
its best reasonable coverage case.

The before arm reproduces the prior planner's 40 percent listing ceiling, 24
quotes per fund, 0.1 percent issuer cap, and holding-only eligibility. The after
arm runs the proposed production rules directly.

Command:

```bash
npx tsx scripts/sim/indexFundLiquidity2026-09-03.ts
```

## Results

| Metric                                 |              Before |                After |
| -------------------------------------- | ------------------: | -------------------: |
| Eligible listings with a bid           |   147 / 368 (39.9%) |     368 / 368 (100%) |
| Bid depth                              | 8.90 million anchor | 14.08 million anchor |
| Ask depth                              | 9.27 million anchor | 14.65 million anchor |
| Median bid size                        |          143 shares |           338 shares |
| Maximum bid size                       |          143 shares |           716 shares |
| Ten-percent shock loss                 | 0.91 million anchor |  1.44 million anchor |
| Bid escrow as share of total fund cash |                4.9% |                 7.8% |

The after arm increases aggregate bid depth by 1.58 times and coverage by 2.50
times. All bids are backed by fund cash and all asks are bounded by shares the
fund already owns. The simulated shock loss is 0.08 percent of aggregate fund
assets, below the existing per-fund 0.5 percent stress-loss ceiling.

## Operational rails

- A fund can commit at most 15 percent of its live cash to facility bids.
- A 10 percent price shock can put at most 0.5 percent of its AUM at risk.
- A quote targets the least of 50,000 anchor, 0.5 percent of issuer market cap,
  one percent of issued shares, and remaining fund risk budget.
- A fund may quote at most 64 listings. Assignment balances slots between
  eligible funds.
- Funds with queued redemption liabilities do not deploy bond cash, rebalance,
  or quote until the queue clears.
- No public-float cash account, synthetic money, short sale, or unbacked share
  inventory is introduced.

## Interpretation

The old rules were safe but structurally incapable of market-wide liquidity:
even in the best-case inventory layout they intentionally left 60 percent of
listings without a quote, and a fund could not bid for an in-mandate corporation
until it somehow acquired shares first. The new planner allows bid-only entry
inside the fund mandate, then adds an ask after inventory is acquired. This
bootstraps two-sided markets without relaxing the accounting model.

The route correction is necessary as well as the balance change. Previously a
player market sell bypassed an existing fund bid and failed against issuer cash.
The new path consumes escrow from the best sufficient fund bid and transfers the
shares to that fund. The issuer is not a counterparty and its treasury is not
debited.

## Decision

Accept. The proposed settings materially improve both coverage and executable
depth while remaining inside the existing finite-cash and stress-loss rails.

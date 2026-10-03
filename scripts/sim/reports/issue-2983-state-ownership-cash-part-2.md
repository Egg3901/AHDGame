# Issue 2983 part 2: whole-corporation nationalization and privatization cash

Runtime source: `4ea6702f08be2f117d9950f1ccc5ab98ad0fb47e`.

Part one (#2994) left three nationalization families registered as gaps in the
treasury writer guard. Reading them found more unwitnessed cash than the treasury
legs alone:

- **Whole-corporation nationalization.** The treasury's payout pool, the public
  float's slice credited back to the treasury, the CEO's share of the dissolved
  corporation's cash and the treasury recoup were all unwitnessed. So were the
  shareholder credits: `payShareholders` supports buyout rows, but its only caller
  never passed the ledger context, so no holder row was ever written. The
  dissolved corporation's own closing balance had no leg either. Separately,
  shares the seized corporation held in other companies move to the National
  Corporation, which is also credited their market value in cash with no payer.
- **Privatization IPO.** The float proceeds credit the treasury and no buyer pays
  for them.
- **Privatization auction.** Bid escrow debits, outbid and loser refunds, the
  winning amount credited to the treasury, and a passed-in shell's residual cash
  moved to the National Corporation were all unwitnessed.

## Change

- Treasury writers accept a pass-through corporation for the contra leg.
  Whole-corporation nationalization books the pool and the float slice against
  the seized corporation, and now emits the holder buyout rows, which settle
  there too. Character rows carry the exact credited amount: wallets are
  credited unrounded, and a rounded row left each holder's stock check off by
  the fraction.
- The dissolved corporation's closing balance is read just before deletion and
  witnessed. It shares the `corporation_liquidation` reason with the CEO surplus,
  the treasury recoup, and a passed-in shell's cash moving to the National
  Corporation.
- Owner decision: the IPO float proceeds are a named mint (`privatization_ipo`).
  This changes accounting only, not the amount.
- The held-equity cash credit is witnessed as a named mint
  (`nationalization_held_equity`). Its amount is unchanged.
- Auction bids, refunds and the winning amount share the
  `privatization_auction_escrow` reason. The refund helpers now report whether a
  holder matched, so only cash that landed is witnessed.
- No amount, rounding, unconditional-debit rule or tolerance changed. With shadow
  accounting disabled, behavior is as before.

## Verified outcomes

`stateOwnershipCash.ledger.integration.test.ts` drives the real writers against
the real reconciler, with GBP valued at 0.5 anchor and a USD corporate holder and
fund. It runs 5 cases in memory and the same 5 on an isolated local replica-set
fixture: 10 of 10 pass. Every reconciled case has an unskipped stock check with
zero divergence, a green trial balance and no unattributed entries.

- **Whole-corporation nationalization** (discounted tier, with debt so the CEO
  receives a surplus): 9 entries. They are the pool, the character, corporate
  and fund buyout rows, the float slice, the CEO surplus, the treasury recoup,
  the held-equity credit and the dissolution. The mint and sink legs are the two
  liquidation mints, the held-equity mint and the liquidation sink. Every other
  contra is the seized corporation.
- **IPO:** one `privatization_ipo` mint.
- **Auction sale:** a character bid outbid by a corporate bid, then the sale. The
  two escrow sinks net against the outbid refund and the treasury's proceeds
  under one reason.
- **Auction pass-in:** the shell's cash moves to the National Corporation, and
  the shell's closing leg nets against it.
- **Shadow accounting off:** no ledger rows.

Red check: with the base writers and the new test, all 4 reconciled cases fail on
stock divergences (7, 1, 2 and 2 accounts). The shadow-off case passes, as it
should. Part one's 4 native cases also pass on this head.

The focused nationalization, transaction log, ledger, share trading, subsidiary,
privatization vote, petitions, NPP treasury and route suites (151 files) pass:
1,363 passed, 18 native opt-in cases skipped. Scoped lint, formatting, semantic
diagnostics for all 13 changed TypeScript files and the blocking architecture
checks pass. Semantic diagnostics also pass for every caller of the two refund
helpers, whose return type widened from nothing to a boolean.

## Findings outside this change

- The held-equity credit gives the National Corporation both the shares and
  their cash value, so it creates money. It is now visible as a named mint. The
  credit itself is unchanged, pending an owner decision.
- Imperial character wallets are not in the balance snapshot, so any imperial
  holder row (here and in acquisitions, takeovers and bond payouts) is a ledger
  leg without a stock. None of these fixtures includes one.
- Escrow taken before this change has no witnessed debit. Its refund or sale
  after deploy is a one-sided named mint under the escrow reason, not an
  unattributed one.

## Scope

Crisis interaction costs and peace-term transfers, the remaining part-two
families, are not in this change. These fixtures qualify the flow boundaries, not
the whole world, so this does not clear #968 or the global cash gate in #2159.
No production database was reset or repaired.

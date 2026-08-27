# Ticket #1198 balance report

Run on 2026-08-26 against the production world at turn 416 with:

```text
npx tsx scripts/sim/ticket1198ExitEquityCeiling.ts
```

The harness is read only and deterministic: one snapshot of the live world,
every figure derived from it with the production functions
(`corpExitEquityAnchor`, `sumBondPrincipalAnchor`, `sumCorporateSectorNpv`). It
opens no write path and does not advance a turn.

## What changed

Two rules that were measuring the same corporation against different assets:

| Rule                              | Asset basis                         |
| --------------------------------- | ----------------------------------- |
| Debt ceiling at issuance (before) | cash + sector NPV + CIP             |
| `filterInsolventCorps` (before)   | cash + sector book                  |
| Both (after)                      | cash + sector book + bond portfolio |

Under `marketSystemMode: "plants"` those two bases diverge sharply, because
sectors exit at replacement-cost book (D11) but are valued for credit at going
concern NPV. The ceiling is now additionally capped at
`MAX_BOND_ISSUANCE_EXIT_EQUITY_FRACTION` (1.0x) of realizable equity, and the
insolvency test now counts the corporation's bond portfolio at face, which the
dissolution it triggers has always redeemed into `liquidCapital`.

## The case that opened the ticket

Corporation #624, Tinky Winky Corporation, at turn 415:

| Figure                                  |            Value |
| --------------------------------------- | ---------------: |
| Going-concern equity (cash + NPV + CIP) | A234,449,153,037 |
| Quoted debt ceiling (2x)                | A468,898,306,075 |
| Debt actually drawn                     |   A4,522,737,824 |
| Drawn as a share of the quoted ceiling  |            0.96% |
| Realizable equity the gate used         |   A3,120,790,315 |
| Shortfall the gate found                |   A1,401,947,509 |
| Bond portfolio the gate ignored         |   A1,792,376,780 |

It defaulted at turn 415 on the first bond it had ever issued, refinanced at
9.15% (up from 4.4%), and **defaulted a second time at turn 416** with the
coupon at $10.2M per turn against $4.4M of net income. The second default is on
the record: bond `6a8f705a510e0d563d430d2f`, `defaultedAtTurn: 416`, credit
penalty extended to turn 512.

Under the fix its exit equity is A4,899,810,816 against A4,579,606,862 of debt.
Solvent. Neither default fires.

## Ceiling impact, all 44 player corporations with live bond debt

The largest holdings, by debt:

|   # | Corporation            |           Debt | Going-concern ceiling |   Exit ceiling | Retained |            Room left |
| --: | ---------------------- | -------------: | --------------------: | -------------: | -------: | -------------------: |
| 604 | Vermont Corporation    | A5,280,423,719 |    A1,300,802,137,393 | A6,516,360,574 |     0.5% |       A1,235,936,856 |
| 624 | Tinky Winky            | A4,579,606,862 |      A474,754,413,833 | A4,899,810,816 |     1.0% |         A320,203,953 |
| 484 | The Trump Organization |   A921,741,441 |       A67,018,897,184 | A1,293,864,701 |     1.9% |         A372,123,260 |
| 625 | Aeropagus Inc.         |   A760,457,928 |       A28,420,798,034 |   A713,366,817 |     2.5% |  over by A47,091,110 |
| 483 | Hunt Oil Company       |   A426,926,295 |          A150,322,749 |   A150,322,749 |   100.0% | over by A276,603,547 |
| 557 | Dangote                |   A257,180,689 |       A39,693,534,243 |   A407,358,873 |     1.0% |         A150,178,185 |
| 616 | Doofenshmirtz Evil     |   A138,785,668 |       A26,040,791,872 |   A172,350,245 |     0.7% |          A33,564,578 |
| 482 | Greenbaum Industries   |   A128,231,745 |        A1,551,945,980 |   A243,545,836 |    15.7% |         A115,314,091 |
| 494 | Rgold                  |    A89,433,847 |        A2,087,233,860 |   A320,833,460 |    15.4% |         A231,399,614 |
| 598 | COSTCO                 |    A58,808,601 |       A23,138,755,442 |    A81,381,001 |     0.4% |          A22,572,400 |

The "retained" column looks brutal, and in headline terms it is: a built-out
corporation keeps well under 2% of the ceiling it used to be quoted. But the
ceiling it used to be quoted was never real. What matters is the last column,
and almost everyone still has room.

## Summary

- **4 of 44** player corporations sit above the new ceiling. They keep every
  bond they hold, are not defaulted for being above it, and simply cannot issue
  more until they build. Two of the four are over by rounding-scale amounts
  (#567 by A28,449; #514 by A4,704).
- **6** corporations are spared a default they would have taken on the old
  basis, purely because the portfolio is now counted:

  | Corporation                 |      Portfolio | Shortfall it covers |
  | --------------------------- | -------------: | ------------------: |
  | #604 Vermont Corporation    | A1,613,961,929 |        A378,025,074 |
  | #624 Tinky Winky            | A1,784,091,212 |      A1,463,887,258 |
  | #484 The Trump Organization |   A752,611,076 |        A380,487,816 |
  | #483 Hunt Oil Company       | A1,228,758,607 |        A388,878,755 |
  | #482 Greenbaum Industries   |   A159,779,882 |         A44,465,791 |
  | #598 COSTCO                 |    A33,252,272 |         A10,679,872 |

- **3** remain insolvent on the new basis and would still default if they go
  cash-negative: #625 Aeropagus (A713m of assets against A760m of debt), #567
  and #514 (both dust-scale). These are genuinely short and the gate is doing
  its job.
- **0** corporations are defaulted BY this change. The ceiling only gates new
  issuance; the insolvency test moved strictly in the corporations' favour.

## A note on #483 Hunt Oil

Hunt Oil is over its ceiling while being comfortably solvent: A1.23bn of bond
holdings against A427m of debt, but a going-concern equity of only A75m, so the
pre-existing 2x rule binds at A150m. That is the old rule, unchanged here, and
it is the mirror image of #624: a corporation that is mostly a bond fund reads
as small on an earnings basis. Worth its own ticket; out of scope for this one.

## Decision

Ship at `MAX_BOND_ISSUANCE_EXIT_EQUITY_FRACTION = 1.0`. At exactly 1.0 the
invariant is tight: a corporation that stays inside its quoted ceiling can never
be judged insolvent, because the two are now the same number. Any value above
1.0 reopens the #1198 gap by precisely the amount it is raised.

# Manufacturing product brand report

Generated with production portable lifecycle, brand, output and quality-premium rules. This is a deterministic rule comparison, not a world simulation or a production balance claim.

Both projects start with the same paid 1,200-anchor development cost, require 12 development turns, and allocate half of a 100-unit plant output. Live four-pillar quality is 60. The candidate receives 100 anchor of already-paid delivered advertising on each development turn; the control receives none. Each advertising receipt is a cash-settlement input, never a planned budget.

Brand is average funded advertising per development turn. The price-defense contribution is bounded at 10 quality points for the product portion, scales with lifecycle stage, and uses the project's development cost per required turn as its monetary reference. Unallocated baseline output receives neither the product's development nor brand bonus. The existing quality-premium flag gates price effects.

<!-- prettier-ignore -->
| Turn | Stage | Total units, both | Product units, both | Control quality | Paid brand | Candidate quality | Control premium multiplier | Candidate premium multiplier |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 12 | launch | 100 | 7.5 | 60.2 | 100 | 60.3 | 1.0612 | 1.0618 |
| 35 | growth | 100 | 20 | 61.2 | 100 | 61.8 | 1.0672 | 1.0708 |
| 82 | mature | 100 | 35 | 63.5 | 100 | 65.3 | 1.0810 | 1.0918 |
| 201 | decline | 100 | 20 | 61.2 | 100 | 61.8 | 1.0672 | 1.0708 |
| 260 | retired | 100 | 0 | 60 | 100 | 60 | 1.0600 | 1.0600 |

Native-cash integration tests separately prove a USD buyer debit matches an EUR seller credit at the frozen rate, retry neither pays twice nor accumulates brand twice, changed source denominations refuse before any seller credit, and project CAS races retain their paid receipts.

# Plant cash payback and sovereign reference

Generated with production investment and bond yield rules. Synthetic fixed prices and demand, no world simulation or live data. Initial charged cash is 10,100, including a 100 transfer cost; remaining plant basis is 10,000 and does not enter payback.

| Scenario                             | Cash after 48 turns | Cash after 96 turns | Cash after 192 turns | First cash payback turn |
| ------------------------------------ | ------------------: | ------------------: | -------------------: | ----------------------: |
| Full fill, one percent transfer cost |             4800.00 |             9600.00 |             19200.00 |                     101 |
| Twenty percent tax                   |             3840.00 |             7680.00 |             15360.00 |                     127 |
| Operating cost squeeze               |             2400.00 |             4800.00 |              9600.00 |          Not within 192 |
| No unmet demand                      |                0.00 |                0.00 |                 0.00 |          Not within 192 |
| Operating loss                       |            -1200.00 |            -2400.00 |             -4800.00 |          Not within 192 |

Same-currency short sovereign reference: 6.00% annual yield at par, 48 turns to maturity. This is an annual quote reference, not a cumulative cash return, execution price or guarantee. Fees, default and future reinvestment yields are excluded; returned principal is not income. Missing or foreign-currency quotes return no reference.

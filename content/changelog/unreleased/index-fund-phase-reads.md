---
date: 2026-10-05
title: Index fund turn phase reads less
---

The index fund turn phase no longer reads each fund's in-flight settlement record on every pass, and it loads bond holdings, audit settings, open bids, rebalance records and fund snapshots once per pass instead of once per fund. Fund balances, fills and snapshots are unchanged; the phase spends far less time waiting on the database on large worlds.

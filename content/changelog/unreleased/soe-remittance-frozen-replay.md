---
date: 2026-10-07
title: State enterprise remittances survive a replayed turn
summary: >-
  A corporation turn that is replayed after a crash no longer stops when a
  state enterprise already sent its profit to the Treasury earlier in the same
  turn. The original payment stands, at its original amount and exchange rate.
tags: [economy, nationalization, treasury]
badges: [patch]
areas: [engine]
---

## What changed

- When a turn is replayed, each state enterprise's remittance from the earlier
  attempt is now honoured as it was recorded. A remittance that already landed
  is not paid again and does not stop the turn, even when the enterprise's cash,
  profit or exchange rate has changed since.
- A remittance that stopped part way is finished at its original amount and
  rate instead of being priced again.
- A remittance that was refused because the enterprise lacked the cash stays
  refused.
- A payment record that does not match the enterprise and country it claims to
  belong to stops the turn rather than being paid or skipped on a guess.

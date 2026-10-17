---
date: 2026-10-17
title: Commodity shortages shown after imports
summary: >-
  National and state supply balances on commodity pages and the shortage heat map
  now count imports, so a gap that imports already fill is no longer called a shortage.
tags: [economy, commodities, ui]
badges: [patch]
areas: [frontend]
---

- The commodity page balance card, supply and demand bar, country card and regional breakdown now show the gap that remains after imports reach that country or state, labelled "after imports".
- A market whose production gap is fully covered by imports reads as balanced instead of undersupplied.
- The "Where this market is out of balance" panel notes how much of a premium state's gap is left after imports, or that imports cover it.
- The stock market shortage heat map Country and State lenses count imports the same way.
- Display only: clearing, prices and the economy are unchanged.

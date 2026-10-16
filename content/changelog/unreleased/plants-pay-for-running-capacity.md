---
date: 2026-10-17
title: Plants pay wages and upkeep for the part that is running
summary: When weak demand holds a plant well below full output, it now staffs and pays a crew for the run it actually makes, and pays less idle upkeep on the capacity demand left unused.
tags: [economy, plants, labour]
badges: [patch]
areas: [engine]
---

- A plant held below full output by weak demand now staffs and pays wages for the run it is making, with a minimum crew of a quarter of its active capacity so it is never staffed at zero.
- Crews shrink gradually, by at most 2% of the plant each turn, so there are no sudden mass layoffs. When demand comes back, plants hire back straight away.
- Job counts in a state follow the same rule, so a glutted plant no longer asks the local labour market for workers it is not using.
- Capacity left idle because buyers would not take the output now carries about a third of the usual idle upkeep. Overbuilding still costs something.
- Capacity you idle yourself with the production slider, and mothballed capacity, are billed as before. A plant running at full output is billed exactly as before.

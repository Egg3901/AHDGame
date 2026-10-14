---
date: 2026-10-14
title: Company revenue moves onto real market prices
summary: >-
  From turn 177 to turn 200, every business that was still held near the old
  revenue formula moves onto real market prices in 24 even steps. From turn
  200 every business earns what it actually sells at the market price.
tags: [economy, corporations]
badges: [minor]
areas: [backend]
---

## What changed

Some businesses were still paid close to an old revenue formula instead of what they actually sold, so overbuilt businesses kept earning and businesses in a shortage could not earn the full shortage price. That support is now coming off in 24 even steps, from turn 177 to turn 200. Each turn, every affected business closes the same share of the gap between what it earned and what it would earn at real market prices. From turn 200, every business earns real market prices.

```chart
{
  "type": "line",
  "title": "Share of real market revenue a business earns, by turn",
  "categories": ["176", "180", "184", "188", "192", "196", "200"],
  "unit": "%",
  "series": [
    { "label": "Started with the world", "data": [73.3, 77.8, 82.2, 86.7, 91.1, 95.6, 100] },
    { "label": "Founded by the computer during play", "data": [25.0, 37.5, 50.0, 62.5, 75.0, 87.5, 100] }
  ],
  "caption": "Two typical businesses. Each closes the same share of its remaining gap every turn, so both reach real market prices on turn 200. Businesses players built themselves already earned market prices and do not change."
}
```

## What you may see

- Little change if you built your businesses yourself.
- The biggest changes are for businesses that started with the world, businesses you bought from others, and businesses the computer founded during play.
- Businesses selling into a shortage may earn more. Plants with unused capacity, or selling into a crowded market, earn less each turn until the move finishes.
- Some companies that looked profitable may make a loss. Mines short of ore or missing inputs may produce less.

## If you are losing out

- **Check each sector's page.** It shows what you sold against what you can make, the price each product sells for, and what is holding you back.
- **Mothball plants that sit idle.** Mothballing cuts their running costs and you can reactivate them later. Capacity the market keeps refusing also shrinks on its own after a few turns.
- **Use your pricing.** A lower price posture can win buyers in a crowded market.
- **Secure your inputs.** Set up supply agreements, or give your own plants first claim on what your other businesses produce.
- **Build where buyers are short.** Markets in shortage pay the best prices, and the expand dialog shows unmet demand by market.
- **Mines running short of ore:** use Prospect on the mine's sector page to search for new deposits. Your odds are better with a higher R&D score.
- **Cut what will not recover.** You can list a sector for sale or close it.

## How it is going

```chart
{
  "type": "line",
  "title": "Corporate revenue and net income per turn, turns 170 to 179",
  "categories": ["170", "171", "172", "173", "174", "175", "176", "177", "178", "179"],
  "prefix": "₳",
  "unit": "M",
  "series": [
    { "label": "Revenue", "data": [384.7, 391.3, 397.5, 403.7, 410.3, 415.9, 420.7, 427.1, 433.1, 439.9] },
    { "label": "Net income", "data": [114.1, 117.1, 117.9, 119.7, 117.9, 122.2, 120.3, 120.2, 126.0, 126.5] }
  ],
  "caption": "All companies except state companies, in anchor currency, through turn 179. Update to turn 200 when this ships."
}
```

Through turn 179 company revenue and income kept rising. The share of companies making a loss moved from about 8% to 9%.

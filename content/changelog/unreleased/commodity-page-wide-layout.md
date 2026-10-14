---
date: 2026-10-14
title: Wider commodity pages with a framed market map
summary: Commodity pages use the full screen width, frame the map on the countries that trade the good, and show electricity in GWh and TWh.
tags: [ui, commodities, economy]
badges: [minor]
areas: [frontend]
---

- Commodity pages now use the full width of larger screens. The price chart sits beside the supply and demand balance, the pooled ledger and the out-of-balance list.
- The market map frames the countries that hold the market instead of the whole globe, ranks every country beside the map, and shows the value on hover. Smaller markets are easier to see on the map. Scrolling the page no longer zooms the map; hold Ctrl to zoom.
- Electricity volumes read in MWh, GWh and TWh, so 1.9 million MWh now shows as 1.9 TWh. Negative balances show a minus sign.
- The regional breakdown is a compact table that sorts countries by market size and shows the largest 8 regions per country, with an option to show all of them.

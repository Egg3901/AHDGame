---
date: 2026-10-01
title: Countries export only what they have spare
summary: >-
  Trade between countries could send more of a good abroad than a country had
  left over after its own buyers, which emptied its home market on paper and
  raised its prices. Exports now stay within each country's surplus.
tags: [economy, trade, markets]
badges: [patch]
areas: [engine]
---

## What changed

- A country's exports of a good are now capped at what it has left after its own buyers, and a country's imports at what it is short. Before, an importer that could only buy from one or two partners had its whole shortfall assigned to them, so Hungary and Bulgaria shipped about fifty times their spare software every turn and Czechoslovakia shipped eight times its spare electricity.
- Because those exports were counted against the exporter's own supply, its home market read as empty: prices rose and its businesses reported missing inputs that were sitting in its own plants. Those markets now show the supply they have.
- Demand that no allowed partner can serve stays unmet instead of being filled by goods that do not exist.

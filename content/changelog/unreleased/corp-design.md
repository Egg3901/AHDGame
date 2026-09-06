---
date: 2026-09-06
title: Sector type divisions on the corporation Sectors tab
summary: >-
  The Sectors tab now reads as the separate businesses a corporation actually
  runs. A rail across the top splits your sites by type, and opening one gives
  you a briefing on what that business does, live figures for it, and every
  operating strategy it can run with the commodity chain each one buys and
  sells.
tags: [corporations, sectors, strategies, interface]
badges: [minor]
areas: [frontend]
era: "Beta 2"
---

Cut from development.

## Changed

- The Sectors tab opens with a type rail listing every sector type the
  corporation owns, with a count on each. Picking one filters the table to that
  type and opens its division view; All sectors returns the full list.
- A division opens with a dossier: a period photograph, two sentences on what
  the business does and what moves its margin, and a five figure strip. Revenue
  and profit come first, then three figures chosen for the type. Manufacturing
  shows line utilisation and output mix, extraction shows deposit capacity,
  logistics shows freight capacity, network coverage and the sprawl penalty its
  depots are buying back.
- Under the dossier, an Operating strategies panel lists every strategy the type
  offers. Each tab carries the number of sites running it, strategies nothing is
  running are greyed, and the selected one shows its description, the sites on
  it, and the commodities it consumes and produces with their rates.
- The sector table takes the division's language: Manufacturing plants,
  Extraction mines, Energy power stations, with a build button that says open a
  store or sink a mine rather than New sector, and the expand flow now opens on
  the division you were reading.

## Added

- Each sector type has a written briefing covering all seventeen types, and a
  period photograph for the eleven the art covers. The remaining six render a
  tinted banner in the type's colour.
- Two type specific controls per sector type, thirty four in all, covering every
  type from retooling a manufacturing line to booking a headline act at a venue.
  None of them exist in the game yet, so they render as disabled buttons whose
  tooltip says what they would do.

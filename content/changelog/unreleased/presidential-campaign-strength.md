---
date: 2026-09-19
title: Anyone can fund a presidential campaign's strength again
summary: >-
  Contributing campaign strength is open to every player, not only the
  candidate. The control had been folded in behind the campaign desk's
  manage-only section, so the nominee, their managers and their running mate
  were the only people who could still see it.
tags: [elections, campaigns, presidential]
badges: [patch]
areas: [frontend]
---

Cut from development.

## Fixed

- The Campaign Strength contribution on a campaign's page is visible again to
  every player who visits it, on desktop and on mobile. Campaign strength has
  always accepted a contribution from any player in the race's country, and the
  top contributors list is built on exactly that, but the rebuilt campaign desk
  put the button inside the section reserved for the people running the
  campaign. That left the candidate as the only person who could fund their own
  strength.
- A campaign desk for a Senate, Governor, House or State Senate race no longer
  offers a contribution it cannot take. Campaign strength only moves votes in
  presidential races, so those pages now say so instead of showing a button that
  fails.
- Campaign strength is readable on a phone again. The figure and its
  contributors tooltip sat in a column the race table drops on small screens,
  so a phone showed the Support button with nothing to say what it was
  supporting. The number now appears under the candidate's name instead.
- The campaign desk's manager list, and the controls to appoint and remove
  managers, now appear on a phone. They had only ever been built into the
  desktop rail.
- A signed out reader is asked to sign in rather than being shown a price, a
  reader from another country is told contributions stay inside their own, and
  a candidate who has suspended their campaign no longer collects one. Each of
  those was a price quoted for a contribution the game would refuse.

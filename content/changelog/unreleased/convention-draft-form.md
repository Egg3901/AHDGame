---
date: 2026-10-02
title: Draft a constitutional convention from the Regime Health tab
summary: >-
  After announcing a constitutional convention, the leader now drafts it on
  the Regime Health tab: the new system of government, the share of the new
  legislature reserved for the ruling party, and when the first election is
  held.
tags: [one-party-state, convention, regime]
badges: [patch]
areas: [frontend, backend]
---

## What changed

- An announced convention shows a draft form on the Regime Health tab. Before, the tab told leaders to send the draft to an API address, and following that link opened a missing page.
- The form offers only the systems of government your country's convention can adopt, the reserved share from 0 to 35%, and a first election 12, 24 or 48 turns after the draft deadline.
- The form shows the turn the country converts and calls its snap election for the choices you make, and asks for confirmation before submitting, because a draft cannot be changed.
- After submitting, the tab shows the locked terms and the turns ratification starts and the conversion happens.
- The convention explainer now describes your own country's options instead of China's.

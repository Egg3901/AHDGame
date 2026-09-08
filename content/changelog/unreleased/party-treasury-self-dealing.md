---
date: 2026-09-08
title: Party treasury approvals now take any two officers, and self-payment rules have changed
summary: >-
  An officer could pay themselves from the party treasury in one unreviewed step
  whenever the Treasurer seat was empty. Approvals now take any two different
  officers, nobody can approve a payment to themselves, and state party funds
  follow their own rules. A party with a single player still runs on its own.
tags: [parties, treasury, security]
badges: [minor]
areas: [backend, frontend]
---

## What changed

- Either approver can now be the Chair, the Vice-Chair or the Treasurer. The old
  rule reserved the first slot for the Treasurer, so a party without one could
  not use two-person approval at all. A Chair and a Vice-Chair are now enough.
- The same person cannot fill both slots, and nobody can approve a payment that
  is going to themselves. A payment to any character on your own account counts
  as a payment to yourself.
- Sending party funds to your own character always needs a second officer,
  whatever approval mode the party is on. It used to go straight through on
  single approval.
- An empty Treasurer seat no longer drops a party to single approval. Parties
  with several members and only one officer need to appoint a second one.
- A party whose only member is a single player approves its own spending on its
  own, including paying itself. There is nobody to countersign, and NPP members
  cannot approve anything, so the alternative would be a treasury nobody can
  touch.
- State parties can fund their own members, including their own officers,
  without a second approval. A state party treasury is its own money.
- Because of that, moving national funds down to a state party you belong to now
  always needs a second officer, even on single approval. Transfers to a state
  party you are not a member of follow the party's normal rules.
- A pending payment now checks that the recipient is still a member of the party
  at the moment it is approved, not only when it was proposed.
- Caucus chairs still cannot send caucus funds to themselves. A caucus has one
  officer, so there is no second signature to ask for.
- The Pending Transactions panel explains all of this, and no longer labels the
  two columns as Treasurer and Chair.

## Why it matters

The rule that the first approver had to be the Treasurer meant a party with an
empty Treasurer seat could not run a two-person approval at all, so the game
quietly let a single officer act alone instead. That is the wrong trade: it took
the safety off exactly when a party was short-staffed. Requiring any two
different officers keeps the two-person guarantee without depending on one
particular office being filled, and the one case where two people genuinely do
not exist, a party of one player, is handled openly rather than by silently
dropping the requirement for everyone.

---
date: 2026-09-07
title: Party officers can no longer pay themselves without a second signature
summary: >-
  A party whose Treasurer seat was empty fell back to single approval so it could
  keep spending. That fallback also let an officer send the treasury to their own
  character in one unreviewed step. Payments to yourself now always need a second
  officer to sign, and the fallback switches off while a Treasurer election is
  about to be decided.
tags: [parties, treasury, security]
badges: [patch]
areas: [backend]
---

## What changed

- Sending party treasury funds to your own character now always requires a second
  officer to approve it, whatever approval mode the party is running. It used to
  go straight through whenever the party was on single approval.
- Nobody can approve a payment that is going to themselves. Previously a Chair
  with no Treasurer seated could sign one half of a payment by proposing it and
  the other half by standing in for the empty Treasurer seat.
- While a Treasurer election is within six turns of closing and somebody is
  actually standing in it, the empty seat no longer drops the party to single
  approval. Outbound transfers pause until the new Treasurer takes office.
- If nobody has entered the Treasurer race, the fallback stays on, so a party
  with no candidates does not get locked out of its own money.
- A queued Request Funds cannot be paid out during that pause either, so the
  pause cannot be stepped around by asking for the money instead of sending it.
- Caucus chairs can no longer send caucus funds to themselves. A caucus has only
  one officer, so there is no second signature available to ask for.
- State party officers, and the national Chair acting on a state party, can no
  longer send state party funds to themselves either. That route had no approval
  step at all, and the national Chair is authorised on every state party, so it
  was the widest version of the same problem.
- A pending payment now checks that the recipient is still a member of the party
  at the moment it is approved, not only when it was proposed. A payment could
  previously be queued, the recipient could leave, and the payment would still go
  through days later.
- All of the above treat a payment to any character on your own account as a
  payment to yourself.

## Why it matters

The empty Treasurer seat was meant to be a safety valve so a party without a
Treasurer could still pay its bills. It also handed whoever held the Chair the
ability to move the entire treasury into their own campaign account in a single
click, with nothing recorded as an approval and nobody asked. The safety valve is
still there for parties that genuinely need it, but it no longer covers payments
to the person making them, and it stands down at the moment a Treasurer is about
to be seated.

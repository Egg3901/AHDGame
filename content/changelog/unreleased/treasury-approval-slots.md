---
date: 2026-09-19
title: Any two officers can approve a treasury transaction
summary: >-
  The two approval slots on a party treasury transaction are no longer tied to
  particular seats. Any two different officers can sign, so a party with a
  Chair and a Vice-Chair but no Treasurer keeps real two-person approval
  instead of dropping to one signature. Sending and requesting now also show
  how much the member can still receive this turn, and refuse an amount that
  could never be paid.
tags: [parties, treasury, approvals]
badges: [minor]
areas: [fullstack]
---

Cut from development.

## Changed

- Approver 1 and Approver 2 on a pending treasury transaction are just the
  first and second signature now. Any of the Treasurer, Chair or Vice-Chair can
  fill either one. The only rules are that the two signatures come from two
  different people, and that nobody approves their own Request Funds.
- Because of that, two-person approval no longer needs a seated Treasurer. A
  party with a Chair and a Vice-Chair now keeps two-person approval, where
  before it quietly dropped to a single signature. Approval falls back to one
  signature only when fewer than two officers are seated. Transactions already
  waiting finish under the rules they were created with.
- Send to Member and Request Funds now show how much the member can still
  receive this turn, not just the ceiling. The figure counts the national
  treasury, every state party and every caucus together, which is how the limit
  is actually applied.

## Fixed

- A request or a payment larger than the per turn limit is refused when it is
  made, instead of being accepted and then failing at the end of approval. Such
  a transaction could never be paid on any turn, whatever it was that had
  already been spent.
- An approval is no longer consumed when the payment behind it is refused.
  Previously the signature was recorded first, so a refusal left a transaction
  that looked approved, could not pay out, and swallowed the second approval
  the same way if anyone tried again.

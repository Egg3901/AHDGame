---
date: 2026-09-19
title: Treasury approvals pay out exactly once
summary: >-
  A party treasury transaction can no longer pay out twice. Two officers
  approving at the same moment now settle who completes it before any money
  moves, and a transfer that has already gone through is never handed back as
  though it had failed. Piercing the Treasurer reserve without the Treasurer is
  recorded as an emergency override again, and the per turn limit is quoted in
  the party's own currency.
tags: [parties, treasury, approvals]
badges: [patch]
areas: [backend]
---

Cut from development.

## Fixed

- A treasury transaction can no longer be paid out twice. When two officers
  approved at nearly the same moment, each filled a different approval slot and
  each then saw a fully approved transaction, so both went on to move the
  money. Completing a transaction is now claimed by one approver before any
  funds move, and the other is told their approval was recorded and someone
  else is finishing it. A transaction that was cancelled or that expired while
  approvals were being collected now says so, instead of telling the approver
  to wait for someone who is not coming.
- A transfer that has already gone through is no longer reported as a failure.
  Writing the audit trail happens after the money moves, and a failure there
  used to unwind the approval and reopen the transaction, leaving it ready to
  spend the same funds a second time. The payment now stands and the audit
  failure is logged for staff instead.
- A failed payment can no longer leave the party treasury short. The live
  database applies the debit and the credit one after the other rather than as
  one indivisible step, and a failure in between put the money back. A failure
  in the putting back was itself unhandled, so the funds simply vanished from
  the treasury and the transaction reopened for someone to spend a second time.
  Those transactions now stop and are held for staff to reconcile.
- Piercing the Treasurer reserve target is recorded as an emergency override
  again. Since any two officers can sign, a Chair and a Vice-Chair could empty
  the reserve with nothing in the record to show it, because the old rule
  assumed the Treasurer had signed every completed transaction.
- An admin can once again send an amount above the per turn member limit. The
  limit was being applied before the admin exemption, so the exemption could
  not be reached by any amount large enough to need it.
- The per turn limit quoted when a send or request is refused now uses the
  party's own currency symbol instead of always showing dollars.

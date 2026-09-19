---
date: 2026-09-17
title: Identity history for duplicate-account review
summary: >-
  Admins and moderators can expand an account in the Players panel to see every
  IP and browser fingerprint it has been seen on, with start and end dates.
  Values an account has rotated away from now keep linking it to other accounts
  for 90 days, so changing a fingerprint no longer hides a group.
tags: [admin, moderation, alt-detection, privacy]
badges: [minor]
areas: [fullstack]
---

## What changed

- Record per-value observation runs for IP addresses and browser fingerprints in
  a new `identityObservations` collection. Returning to an earlier value opens a
  new run, so a rotation trail reads as separate rows with their own dates.
- Add a collapsed "IP history" and "Fingerprint history" section to each account
  in the duplicate-groups view, paginated 10 rows per page, each track paged
  independently. Rows another account has also been seen on are highlighted.
- Group accounts on values seen within the last 90 days, not just their current
  ones. Historical matches carry their own "(past)" badges so a current match is
  never presented as the same evidence as an old one.
- Flag any group member whose only link is a shared IP with a "Weak match"
  badge. The existing group-level cgNAT warning could not do this, because it
  required every member to be IP-only and so went quiet on mixed groups.
- Label the IP intelligence block with the address it describes, and mark it
  when that address is not the account's current one or not what links the
  group. It previously showed a city and ISP for an address the account had
  stopped using, which reads as evidence that the accounts are unrelated.

## Retention

Identity history is kept for 90 days from the last time a value was seen, and is
enforced by a database TTL rather than by application code. Deleting an account
removes its history along with the account.

## Notes

- Capture is fire-and-forget at every observation point, so it cannot slow or
  fail a login, a registration or a page load.
- Repeat sightings of the same value inside a one-minute window are collapsed,
  so the observation counter reflects distinct sightings rather than page views.
- Sentinel addresses, Cloudflare edge addresses and placeholder fingerprints are
  rejected when the run is written, so they can never reach account grouping.

---
date: 2026-09-10
title: Safer Google and Discord linking
summary: Provider link and unlink now verify the current session and detect concurrent account changes.
tags: [auth, accounts]
badges: [patch]
areas: [backend]
---

- Google and Discord link and unlink verify the signed session against the
  freshly read account, so signed-out, revoked, or banned sessions cannot
  change provider links.
- Link and unlink writes are bound to the exact password, provider, and
  revocation snapshot. A competing change fails safely instead of being
  overwritten; unlink reports it as a conflict and never claims success
  without a confirmed write.
- Linking never silently replaces a different existing provider link; the
  old link must be explicitly unlinked first.
- Unlinking the last remaining sign-in method is rejected, unless there is
  nothing to unlink.
- Successful link and unlink sign out existing sessions, so reauthentication
  is required afterwards.
- A Google or Discord link started by one account cannot complete for a
  different account or session after the browser returns from the provider.
- Google and Discord identities have unique database ownership. Conflicting
  links are rejected without modifying either account.
